# Calendar Feed Game Import — Implementation Plan

**Status:** Revised after architecture review round 1
**Date:** 2026-08-29

## Goal

Let a coach link an external team calendar (an iCalendar / `.ics` feed such as
PlayMetrics' published team calendar) to a TeamTrack team, and have TeamTrack
create and keep up to date the `Game` rows for that team's schedule — instead of
hand-entering every opponent, date, and home/away toggle in the
[Home.tsx](../../src/components/Home.tsx) create-game form.

Reference feed used to design the parser (real data, saved locally as
`games-calendar.ics`, **not committed to the repo**):
`https://calendar.playmetrics.com/calendars/c<REDACTED>/t<REDACTED>/p0/t<REDACTED>/f/games-calendar.ics`.
This URL is a bearer credential (see Schema changes, "feed URL storage") —
redacted here per architecture review Major 9. The raw fixture used for parser
tests must likewise be scrubbed of any property that echoes the live URL
(`URL:`, and any `X-*` field that isn't needed) before it is committed.

## Decisions locked with the product owner

| # | Question | Decision |
|---|---|---|
| 1 | Sync model | **Saved feed URL per team + manual "Sync now".** Built so a scheduled/background sync can be added later without rework. |
| 2 | Schema depth | **Dedupe key + venue.** New fields on `Game`; feed config on `Team`. |
| 3 | Re-sync semantics | **Auto-apply, protect live games.** No approval screen. Never mutate a game whose `status !== 'scheduled'`. Games cancelled in the feed are flagged, never deleted. |
| 4 | Parser scope | **Generic RFC-5545 core + pluggable provider adapters.** Ship the PlayMetrics adapter now. |

### Derived decision A: feed *metadata* lives on `Team`; the feed *URL* lives in a minimal `CalendarFeed` model — revised per architecture review Major 1

Decision 2 rejected a full separate-model design for feed depth, and the
original draft of this plan put everything — including the URL — on `Team`.
Architecture review flagged that as a real security problem, not a style
preference: every `Team` read in this app is an unfiltered `observeQuery` with
a default selection set ([useAmplifyQuery.ts:53](../../src/hooks/useAmplifyQuery.ts:53),
used from `Home.tsx`, `Management.tsx`, and elsewhere). A field on `Team` isn't
"coach-scoped storage" in practice — it's broadcast to every screen that reads
the team, lands in browser memory, in the offline IndexedDB cache, and
plausibly in a bug-report attachment (this app ships a bug-report system that
captures `systemInfo` and screenshots). The feed URL contains an unguessable
path token that is itself the read credential for the coach's PlayMetrics
schedule — it must not be on that broadcast path.

Resolution: split by sensitivity, not by cardinality.

- **`Team`** keeps the non-secret status fields coaches see on every load:
  `calendarFeedProvider`, `calendarFeedTeamAlias`, `calendarFeedHost` (display
  only — the hostname, never the full URL), `calendarFeedLastSyncedAt`,
  `calendarFeedLastError`.
- **A new minimal `CalendarFeed` model** (`teamId`, `url`, `coaches`,
  `allow.ownersDefinedIn('coaches')`, no field-level exceptions) holds the URL
  itself. It is queried only by `CalendarFeedSettings.tsx` when the coach opens
  the link/edit flow — never joined onto the `Team` read every other screen
  already does. This also happens to deliver the multi-feed extension point the
  original draft only promised: a second `CalendarFeed` row is a `teamId`
  index away, no migration needed.

This is still "one feed per team" for now (enforced by the Lambda checking for
an existing row before creating a second one, not by a uniqueness constraint —
DynamoDB doesn't have one).

### Derived decision B: parsing happens server-side, in the Lambda, for both entry points

Both entry points — pasted URL and uploaded `.ics` file — call the **same**
`syncTeamCalendar` mutation. The URL path has the Lambda fetch the bytes; the
file path has the browser read the file as text and pass it as an argument. The
browser never parses. Rationale:

- `Game` **create is Lambda-only** already (model grant is `['read','update']`
  only; see [resource.ts:179](../../amplify/data/resource.ts:179)). Any importer
  must go through a Lambda regardless, so putting the parser there costs nothing.
- One parser implementation, one set of tests, no `src/` / `amplify/` duplication.
- Server-side parsing means the dedupe and protection rules cannot be bypassed by
  a crafted client request.

AppSync's request payload limit is 1 MB; a full season `.ics` is a few KB. The
client caps uploads at 512 KB before sending.

## Findings from reading the codebase

1. **`Game.create` is not grantable to coaches.** [resource.ts:174](../../amplify/data/resource.ts:174)
   routes creation through `createGameSafe`. The sync Lambda must write with the
   DynamoDB SDK the same way [create-game-safe/handler.ts](../../amplify/functions/create-game-safe/handler.ts)
   does, not via the Data client.
2. **`coaches` must be derived server-side from `Team.coaches`.** This is both the
   population rule (CLAUDE.md) and the authorization check — a caller not in
   `team.coaches` is denied. Copy the `ConsistentRead: true` `GetCommand` pattern
   from create-game-safe verbatim, including its rationale.
3. **Archived teams reject new games.** `createGameSafe` throws when
   `team.status === 'archived'`. Sync must apply the same guard, and the UI must
   hide or disable the sync controls for archived teams.
4. **Field-level auth gotcha with defaults.** Any new field carrying `.default()`
   needs `'create'` in its field-level grant, or AppSync rejects the write as
   Unauthorized on that field *even when the request never mentions it* — the
   lesson already documented on `Team.status`
   ([resource.ts:85](../../amplify/data/resource.ts:85)). New import fields
   should therefore either carry no `.default()` or include `'create'`.
5. **`Game` has no delete grant.** Deletion is `deleteGameSafe` only. This
   reinforces Decision 3's "flag, don't delete" for feed-cancelled games.
6. **No date library in `dependencies`.** Timezone conversion must use the
   built-in `Intl` API — see the timezone section below.
7. **Vitest's `include` is `**/*.test.ts`**, so parser and handler tests under
   `amplify/` run in `npm run test:run` alongside `src/` tests. Existing
   precedent: `amplify/functions/create-game-safe/handler.test.ts`.
8. **Game creation UI** is the inline form at [Home.tsx:636](../../src/components/Home.tsx:636);
   team settings live in [Management.tsx](../../src/components/Management.tsx).
9. **DynamoDB SDK writes don't fire AppSync subscriptions.** `Home.tsx` already
   works around this for `createGameSafe` with a `pendingCreatedGames` overlay
   ([Home.tsx:130-147](../../src/components/Home.tsx:130)) that holds
   Lambda-returned games until `observeQuery` catches up. The sync mutation
   must return full `Game` objects (not just counts) so the same mechanism can
   absorb them, and the sync entry point needs to live where that overlay
   lives.
10. **No handler in `amplify/functions/` uses a DynamoDB `Query`/GSI.** Every
    multi-record read (`delete-game-safe`, `delete-team-safe`,
    `delete-player-safe`, `archive-team`) does a paginated `ScanCommand` with a
    `FilterExpression` — see [delete-game-safe/handler.ts:22-42](../../amplify/functions/delete-game-safe/handler.ts:22).
    The sync Lambda's "list the team's games" step follows the same pattern:
    a scan, not a query, and the IAM grant must say `Scan` accordingly.
11. **This would be the third handler with the same team-fetch +
    `coaches.includes(callerSub)` + `status === 'archived'` triple**, and the
    sixth copy of a paginated `scanAll` helper. Both are worth extracting to
    `amplify/functions/shared/` given this plan already introduces that
    directory for the iCal parser.

## Parsing the real feed — the traps

These come from reading the actual PlayMetrics file, not from the RFC in the
abstract. Each one is a concrete test case.

### Line unfolding must happen before anything else

Event 3's `DESCRIPTION` in the raw file is split mid-team-name:

```
DESCRIPTION:DMSC - DMSC U13 Boys Blue at Iowa United FC U13 Boys
  Navy\nArrive by 2:45 PM\nMartin Field 1
```

Unfolding (strip CRLF plus exactly one following space or tab) yields
`...U13 Boys Navy`. Consuming zero or two spaces corrupts the opponent name.
Note the **two distinct newline concepts**: the physical fold, and the literal
`\n` escape sequence inside the property value. Unfold first, then unescape
`\n`, `\,`, `\;`, `\\`.

### Home/away and opponent come from prose, not fields

`SUMMARY` is useless — it is `Iowa United FC U13 Boys Navy - Game` for every
event. The first `DESCRIPTION` line is `<away> at <home>`, verified against the
data:

- `Iowa United FC U13 Boys Navy at BSC - MID-IOWA U13 BOYS` — we are listed
  first, so **away**; opponent = `BSC - MID-IOWA U13 BOYS`.
- `DMSC - DMSC U13 Boys Blue at Iowa United FC U13 Boys Navy` — we are listed
  second, so **home**; opponent = `DMSC - DMSC U13 Boys Blue`.

**Identifying "us"**: derive from `X-WR-CALNAME`
(`Iowa United FC U13 Boys Navy Games`) by stripping a trailing ` Games`. Match by
checking whether the description line *starts with* `<us> at ` (away) or *ends
with* ` at <us>` (home). Do **not** naively split on the first ` at ` — team
names can contain it.

Persist the detected name as `Team.calendarFeedTeamAlias` on first successful
sync, and let the coach correct it, because the TeamTrack team name
(`U13 Boys Navy`) need not match the feed's.

### Venue is inconsistently placed

The third description line is the field name when present
(`Bondurant Recreational Sports Complex East 4`, `Martin Field 1`), and
`LOCATION` is a street address. But events 6 and 7 have only two description
lines and put the venue name in `LOCATION` (`Tuma Soccer Complex 35`) with no
address at all. The adapter must tolerate both and never assume three lines.

### Timezone conversion

`DTSTART;TZID=America/Chicago:20260912T110000` must become a UTC ISO string for
`Game.gameDate`. With no date library available, resolve the offset with
`Intl.DateTimeFormat` in the named zone (Node 22 ships full ICU) — a small
`zonedWallTimeToUtc(wallTime, tzid)` helper, plus handling for:

- `DTSTART:20260912T160000Z` (UTC suffix) — use directly.
- `DTSTART:20260912T110000` (floating, no TZID) — fall back to the calendar's
  `X-WR-TIMEZONE`, then to UTC.
- DST boundary wall times (nonexistent or ambiguous hours) — pick a documented
  rule and test it.

The embedded `VTIMEZONE` block with its `RRULE`s is **ignored**; implementing
RRULE-driven offset math is not worth it when IANA data is already in the runtime.

### Other iCalendar handling

- `STATUS:CANCELLED` or `METHOD:CANCEL` — treat as cancelled (flag, don't delete).
- `SEQUENCE` / `LAST-MODIFIED` — change detection; skip rewriting unchanged events.
- `UID` (`Game_4841731`) — the dedupe key.
- `RRULE` on a `VEVENT` — out of scope for v1; skip with a warning (games don't recur).
- `VEVENT`s that aren't games (practices, team events) — the PlayMetrics *games*
  feed contains only games. v1 rule: import every `VEVENT`; revisit when a mixed
  feed actually shows up.

## Schema changes

### `amplify/data/resource.ts` — `Game`

```ts
// External calendar provenance (Calendar Feed Import). Written only by the
// syncTeamCalendar Lambda; coaches read but never write these directly.
externalUid: a.string(),            // VEVENT UID, e.g. "Game_4841731"
externalSource: a.string(),         // 'playmetrics' | 'ics'
externalSequence: a.integer(),      // VEVENT SEQUENCE, informational only —
                                     // NOT the change-detection signal (see below)
externalContentHash: a.string(),    // sha256 of the import-owned fields; drives
                                     // skip-vs-update, since SEQUENCE is
                                     // optional in RFC 5545 and many producers
                                     // never increment it (architecture review
                                     // Major 7b)
externalSyncedAt: a.datetime(),
externalCancelled: a.boolean(),     // feed says CANCELLED; game kept + flagged
externalHomeAwayUnverified: a.boolean(), // generic adapter guessed isHome; see below
// locationName/locationAddress/arriveByTime are feed-owned but coach-editable
// (see "Coach edits vs. re-sync" below): the feed overwrites them on every
// content-hash change, so a hand correction survives only until the next sync.
locationName: a.string(),           // "Martin Field 1"
locationAddress: a.string(),        // "3740 86th St., Urbandale, IA 50322"
arriveByTime: a.datetime(),         // parsed from "Arrive by 2:45 PM"
```

None carry `.default()`, sidestepping Finding 4. Field-level grants restrict the
`external*` fields to `['read']` for coaches (Lambda writes bypass field auth by
going through the SDK), matching the `archivedAt` / `archivedBy` precedent.
`locationName`, `locationAddress`, and `arriveByTime` stay coach-writable.

**Coach edits vs. re-sync (architecture review Major 7c):** feed always wins.
If a coach hand-edits venue or arrive-by and a later sync sees a changed
content hash for that game, the edit is overwritten with no merge. This is the
simplest rule consistent with Decision 3's no-approval-screen auto-apply, and
must be stated as such in the `CalendarFeedSettings` and game-card copy —
"imported fields may be overwritten on the next sync" — so it isn't a surprise.

**Idempotent id (architecture review Major 4):** `Game.id` for an
externally-sourced game is not a fresh `randomUUID()`. It is deterministically
derived — `sha256(teamId + '|' + externalSource + '|' + externalUid)`,
formatted as a UUID-shaped string — so that two concurrent sync invocations
(double-tapped button, retried request, an overlapping future scheduled sync)
converge on the same id instead of creating duplicates. Creates use
`ConditionExpression: 'attribute_not_exists(id)'`, which makes create itself
idempotent for free. Hand-created games keep random ids; this scheme applies
only to sync-created rows.

**Backfill:** none needed. All fields are optional; existing games have them null.

**GSI:** a `gamesByExternalUid` index is *not* added in v1, matching Finding 10
— the sync Lambda lists the team's games via the same paginated `ScanCommand` +
`FilterExpression` pattern every other multi-record handler already uses, and
matches in memory. This is a real per-sync full-table scan, not "tens of
games" — acceptable for manual, per-team sync today; the Phase 5 risk section
below records it as a scheduled-sync scaling dependency.

### `amplify/data/resource.ts` — `Team`

```ts
calendarFeedProvider: a.string(),     // 'playmetrics' | 'ics'
calendarFeedTeamAlias: a.string(),    // name used to identify "us" in the feed
calendarFeedHost: a.string(),         // display-only hostname, e.g. "calendar.playmetrics.com" — never the full URL
calendarFeedLastSyncedAt: a.datetime(),
calendarFeedLastError: a.string(),
```

All five are Lambda-written, coach-readable status fields — no secret among
them. **The feed URL itself does not live here** (architecture review Major
1): see the new `CalendarFeed` model below.

### `amplify/data/resource.ts` — new `CalendarFeed` model

```ts
CalendarFeed: a
  .model({
    teamId: a.id().required(),
    team: a.belongsTo('Team', 'teamId'),
    url: a.string().required(),   // the bearer-credential feed URL
    coaches: a.string().array(),
  })
  .authorization((allow) => [
    allow.ownersDefinedIn('coaches'), // full coach access — same shape as FormationPosition
  ]),
```

Isolated from the broadcast `Team` read (see Derived Decision A above) — only
`CalendarFeedSettings.tsx` queries this model, when a coach opens the link/edit
flow. The sync Lambda reads it directly by `teamId` via the SDK. It is never
logged, echoed in an error message, or sent to analytics; `calendarFeedHost`
on `Team` is what the UI shows everywhere else.

### New mutation

```ts
syncTeamCalendar: a
  .mutation()
  .arguments({
    teamId: a.string().required(),
    feedUrl: a.string(),      // provided when linking a new URL feed, or
                               // changing the saved one; omit to re-sync the
                               // already-saved CalendarFeed
    icsContent: a.string(),   // provided when uploading a file (Phase 2 only
                               // accepts this argument — see Phasing)
    saveFeedUrl: a.boolean(), // persist feedUrl as this team's CalendarFeed
    dryRun: a.boolean(),      // parse + reconcile, return the result, write nothing
  })
  .returns(a.ref('CalendarSyncResult'))
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(syncTeamCalendar)),
```

`CalendarSyncResult` (architecture review Major 2 — counts alone are not
enough, because SDK writes don't trigger AppSync subscriptions and the UI has
no other way to learn what was written):

```ts
CalendarSyncResult: a.customType({
  createdGames: a.ref('Game').array(),   // full Game objects, for the
  updatedGames: a.ref('Game').array(),   // pendingCreatedGames-style overlay
  skippedCount: a.integer(),
  cancelledCount: a.integer(),
  protectedCount: a.integer(),
  failedCount: a.integer(),
  warnings: a.string().array(),
}),
```

`dryRun` lets the first-link flow show "this will create 12 games, update 2"
without a separate preview code path — the reconciliation logic runs
identically, the write step is just skipped.

**Relationship between the mutation's `feedUrl`/`saveFeedUrl` args and direct
`CalendarFeed` model writes:** `CalendarFeed` grants coaches full CRUD
(`ownersDefinedIn('coaches')`, no `.to()` restriction), so
`CalendarFeedSettings.tsx` can link, edit, or unlink a feed with a plain
`client.models.CalendarFeed.create/update/delete` call — no Lambda involved for
that alone. The mutation's `feedUrl`/`saveFeedUrl` arguments exist as a
convenience for the "paste a URL and sync immediately" flow on `Home.tsx`
(Major 2's entry point): pass `feedUrl` to sync against a URL that isn't saved
yet, and `saveFeedUrl: true` to have the Lambda persist it as the team's
`CalendarFeed` row in the same round trip, instead of requiring two separate
calls. Omitting `feedUrl` re-syncs whatever `CalendarFeed` row already exists.

## Security requirements (must be in place before the URL path ships)

A Lambda fetching a user-supplied URL is a **server-side request forgery (SSRF)**
primitive. Non-negotiable controls:

1. **Scheme allowlist:** `https:` only. Reject `http:`, `file:`, `gopher:`, `data:`.
2. **Host validation:** resolve the hostname and reject any address in a private
   or special range — RFC1918, loopback, link-local (`169.254.0.0/16`, which
   covers the instance metadata endpoint `169.254.169.254`), CGNAT, IPv6 ULA and
   link-local, and IPv4-mapped IPv6 forms. Re-validate **after every redirect**;
   a pre-flight check alone is defeated by a redirect. Note (architecture
   review Minor): a pre-flight IP check is also defeated by DNS rebinding —
   `fetch()` re-resolves at connect time, after the check. Item 7's host
   allowlist is what actually closes this for v1; it is **load-bearing**, not
   redundant with items 1–3. If the allowlist is ever generalized away, a
   connect-time `lookup` hook (e.g. an undici `Agent`) has to replace it.
3. **Redirect cap:** at most 3, each re-validated. Never follow a cross-scheme redirect.
4. **Response caps:** hard limit on `Content-Length` *and* on streamed bytes
   (256 KB), plus a 10 s timeout. Reject content types other than
   `text/calendar` / `text/plain`.
5. **Parser DoS caps:** max 2,000 `VEVENT`s, max 100,000 unfolded lines, max
   10,000 chars per property value. Bail with a clear error rather than looping.
6. **No URL in logs or errors.** Log a hash or the bare host. The stored
   `calendarFeedLastError` must be a sanitized message, since it is persisted and
   rendered back to the coach.
7. **Decision (locked with product owner): host allowlist for the URL-fetch path.**
   `fetchFeed` only fetches from an allowlisted set of hosts
   (`calendar.playmetrics.com` to start; extend the list as new providers come
   up). Any other host is rejected before a connection is attempted — this is
   in addition to, not instead of, the scheme/private-IP/redirect controls
   above. Decision 4's "generic ICS" promise is fulfilled by the file-upload
   path (Phase 2), which has no network fetch and therefore no SSRF surface;
   the URL path (Phase 3) trades that generality for a materially smaller
   attack surface.

Also note: `icsContent` from file upload skips the network controls entirely but
still needs every parser cap in (5), **enforced server-side**: the client's
512 KB cap (Derived Decision B) is advisory only, so the handler does its own
byte-length check on `icsContent` before parsing, ahead of the item-5 caps.
Imported opponent and venue strings are rendered by React, which escapes by
default — but any future `dangerouslySetInnerHTML` or CSV/ICS *export* path
would need re-checking.

## File-by-file changes

### Backend

| File | Change |
|---|---|
| `amplify/functions/shared/teamAccess.ts` *(new — architecture review Major 6)* | `assertTeamAccess(teamId, callerSub, { requireActive })`, returning `{ team, coaches }`. Extracted from `create-game-safe/handler.ts`'s `ConsistentRead` `GetCommand` + `coaches.includes(callerSub)` + `status === 'archived'` triple, carrying the original comments verbatim so the rationale isn't lost. **Used by the new Lambda only** — the existing five handlers are not retrofitted in this change; that's separate, unrelated regression risk in already-audited authz code (noted as a follow-up in Risks). |
| `amplify/functions/shared/dynamo.ts` *(new — architecture review Major 6)* | Paginated `scanAll(table, filterExpression, ...)`, extracted from the pattern repeated in `delete-game-safe`, `delete-team-safe`, `delete-player-safe`, `archive-team`. Same used-by-new-Lambda-only scope guard. |
| `amplify/functions/shared/ical/parser.ts` *(new)* | RFC-5545 core: unfold, unescape, property and parameter parsing, VEVENT extraction, `zonedWallTimeToUtc`. Provider-agnostic. |
| `amplify/functions/shared/ical/adapters/playmetrics.ts` *(new)* | Description-prose parsing: opponent, home/away, venue, arrive-by. Detected via `PRODID:-//PlayMetrics//EN`. |
| `amplify/functions/shared/ical/adapters/generic.ts` *(new)* | Fallback: date, `SUMMARY` to opponent, `LOCATION` to venue. Sets `isHome: false` and `externalHomeAwayUnverified: true` with a warning when it can't determine home/away (architecture review Major 7a — `isHome` is `.required()` with no default; "leave it at the existing default" was not a real option). Sets opponent to a `SUMMARY`-derived fallback (or a literal "Opponent TBD" plus a warning) when `SUMMARY` is empty, since `opponent` is likewise `.required()`. |
| `amplify/functions/shared/ical/adapters/index.ts` *(new)* | Adapter selection by `PRODID` / `X-WR-*`. |
| `amplify/functions/shared/ical/contentHash.ts` *(new)* | `sha256` over the import-owned fields (opponent, isHome, gameDate, locationName, locationAddress, arriveByTime) for change detection, and the deterministic-id derivation from `teamId + externalSource + externalUid` (architecture review Major 4). |
| `amplify/functions/sync-team-calendar/resource.ts` *(new)* | `defineFunction`, runtime 22, `timeoutSeconds: 60`, `resourceGroupName: 'data'`. |
| `amplify/functions/sync-team-calendar/handler.ts` *(new)* | Auth via `assertTeamAccess`, fetch/validate, parse, scan the team's games via `scanAll`, reconcile (conditional writes — see Reconciliation rules below), return `CalendarSyncResult` with full `Game` objects. On a per-event write failure: continue processing the rest, count it in `failedCount`, add a warning — don't abort the batch (safe because ids are deterministic and creates/updates are conditional, so a retried sync is idempotent). |
| `amplify/functions/sync-team-calendar/fetchFeed.ts` *(new)* | The hardened fetcher (all of the security section, including the host allowlist). Separated so it is unit-testable without the handler. |
| `amplify/data/resource.ts` | New `Game` fields, new `Team` fields, new `CalendarFeed` model, `CalendarSyncResult` custom type, `syncTeamCalendar` mutation. |
| `amplify/backend.ts` | Register the function; grant `dynamodb:Scan`, `dynamodb:PutItem`, `dynamodb:UpdateItem` on the Game table (architecture review Major 5 — **not** `Query`: no GSI exists, so the list step is a `Scan`; a `Query` grant would be both wrong and misleading about the actual read pattern) and `dynamodb:GetItem` on the Team and CalendarFeed tables; set `GAME_TABLE`, `TEAM_TABLE`, `CALENDAR_FEED_TABLE` env vars. Keep the least-privilege `addToRolePolicy` style used for `createGameSafe`, not `grantReadWriteData`. |

### Frontend

| File | Change |
|---|---|
| `src/services/calendarSyncService.ts` *(new)* | Thin wrapper over `client.mutations.syncTeamCalendar`, using `assertMutationResult` like [gameService.ts](../../src/services/gameService.ts). |
| `src/components/CalendarFeedSettings.tsx` *(new)* | Team-settings panel, mounted in `Management.tsx`: link/edit the `CalendarFeed` URL, `.ics` file picker, unlink, and read-only status display (last synced, last error) sourced from the `Team` fields. **Does not itself trigger a live sync** — see `Home.tsx` below for why. Hidden for archived teams. |
| `src/components/Management.tsx` | Mount `CalendarFeedSettings` in the team edit view. |
| `src/components/Home.tsx` | The actual "Sync now" / "Import from calendar" action lives here, next to the create-game form (architecture review Major 2) — this is where `pendingCreatedGames` and `gameRefreshKey` already exist ([Home.tsx:130-147](../../src/components/Home.tsx:130)), so a sync's returned `createdGames`/`updatedGames` can be absorbed into the same overlay `createGame` already uses, instead of needing a new cross-component refresh path. Also: show venue and arrive-by on scheduled game cards; badge feed-cancelled games (`externalCancelled`) and unverified home/away (`externalHomeAwayUnverified`). |
| `src/App.css` | New section appended at the bottom (per CLAUDE.md) for the settings panel and the cancelled/unverified/imported badges. |

### Docs

`docs/ARCHITECTURE.md` gets a Calendar Import section, and a new
`docs/specs/CALENDAR-IMPORT-SPEC.md` records the PlayMetrics description grammar
so a future adapter author is not re-deriving it from a sample file.

## Reconciliation rules (Decision 3, precisely)

Matching key is `externalUid` + `externalSource` + `teamId` (architecture
review Minor — added `externalSource` to prevent a cross-provider UID
collision if a team ever switches feeds). Change detection compares
`externalContentHash`, not `externalSequence` (Major 7b, see Schema changes).

| Existing game | Feed says | Action |
|---|---|---|
| none | active | **create**, `ConditionExpression: attribute_not_exists(id)`, id = deterministic hash (Major 4), `coaches` from team, `status: 'scheduled'` |
| `status === 'scheduled'`, same content hash | active | **skip** (no write) |
| `status === 'scheduled'`, changed content hash | active | **update** — `UpdateCommand` with an explicit `SET` of only the import-owned attributes (never `PutCommand` — a full overwrite would clobber `elapsedSeconds`/`lastStartTime`/`ourScore`/`currentHalf`), `ConditionExpression: '#status = :scheduled AND attribute_exists(id)'` |
| `status !== 'scheduled'` | anything | **protect** — no write attempted at all (checked before issuing the conditional update) |
| `status === 'scheduled'` | cancelled | `UpdateCommand` setting `externalCancelled: true` only, same conditional guard, **never delete** |
| exists, absent from feed | — | **leave alone** (feed windows are partial; absence is not cancellation) |

**Read-then-write race (architecture review Major 3):** the Lambda lists games
via `scanAll` before writing, so a coach could start a game between the scan
and the write. Every update and cancel-flag write above carries
`ConditionExpression: '#status = :scheduled'`; a `ConditionalCheckFailedException`
on that condition is caught and counted as `protectedCount`, not surfaced as
`failedCount` or an error — the same gap `assignTeamOwner` already closes with
a conditional write on its own status check.

Games created by hand (`externalUid == null`) are never touched. The
"absent from feed" rule is deliberate and worth flagging to review: a genuinely
deleted game will linger. Detecting that safely needs a feed-window concept
(min/max `DTSTART` in the payload) — deferred, and called out as a known gap.

## Phasing

Reordered per architecture review Major 8: the original draft deferred the
cancelled-game badge to Phase 4 while Phase 2 already writes
`externalCancelled` — between those phases a coach's schedule would show a
plain `scheduled` card for a match the feed says is cancelled, which is worse
than not importing it. The shared-helper extraction also moves to the front of
Phase 2 so the new handler is written against `teamAccess.ts`/`dynamo.ts`
directly, not refactored into them afterward.

1. **Parser and adapters, pure functions, no backend.** Highest test value, zero
   deployment risk. Test fixture is the real downloaded `.ics`, scrubbed of the
   live URL (see Goal section and Risks).
2. **Shared helpers, schema fields, and `syncTeamCalendar` accepting
   `icsContent` only** (file upload path):
   - `amplify/functions/shared/teamAccess.ts` and `shared/dynamo.ts` land first.
   - Schema: `Game` fields, `Team` fields, the `CalendarFeed` model,
     `CalendarSyncResult`, the mutation. `feedUrl` and `saveFeedUrl` arguments
     are **hard-rejected** by the handler in this phase (not silently
     ignored) — no client should be able to depend on pre-hardening URL-fetch
     behavior before Phase 3 exists.
   - Reconciliation, including the cancelled-flag write, ships complete —
     it's the same code path as everything else in this phase.
   - The `externalCancelled` badge on `Home.tsx` game cards ships **in this
     phase**, not Phase 4, so cancelled-flagged data is never displayed as a
     normal scheduled game.
   - This ships a genuinely useful feature with **no SSRF surface at all**.
3. **Hardened URL fetch, saved feed, Sync now.** The security section applies
   entirely to this phase, including the host allowlist.
4. **UI polish** — venue and arrive-by on cards, the unverified-home/away badge,
   `CalendarFeedSettings` link/unlink flow.
5. **Later, not now:** EventBridge scheduled sync. Phase 3's handler is written to
   take `(teamId)` and do everything else itself, so the scheduler becomes a new
   trigger over the same code, not a rewrite. Depends on the Phase-5 risk noted
   under Schema changes: a per-team full-table scan is fine for on-demand
   manual sync, not for N teams on a schedule — revisit the "no GSI" call then.

Phases 1–2 are shippable on their own and make a reasonable first milestone.

## Test plan

- **Parser unit tests** against the real feed committed as a fixture: all 7
  events, the mid-name fold in event 3, the two-line descriptions in events 6–7,
  home vs away detection, venue-in-LOCATION vs venue-in-description.
- **Timezone tests:** America/Chicago CDT (the September events) and CST, a DST
  spring-forward boundary, a `Z`-suffixed DTSTART, a floating DTSTART.
- **Malformed input:** truncated file, no `VCALENDAR`, no `VEVENT`, CRLF vs LF,
  BOM, unknown `PRODID` falling back to the generic adapter.
- **Security tests on `fetchFeed`:** `http://`, `file://`, `169.254.169.254`,
  `localhost`, a redirect chain ending at a private IP, an oversized response,
  a timeout, a wrong content type, a host outside the allowlist. Mocked
  `dns`/`fetch` only — no real network or DNS dependency, and a
  `// @vitest-environment node` docblock on these test files, since
  [vitest.config.ts:8](../../vitest.config.ts:8) sets `jsdom` globally and this
  repo already has documented full-suite flakiness under default test
  concurrency that a network-dependent test would only add to.
- **Handler tests** mirroring [create-game-safe/handler.test.ts](../../amplify/functions/create-game-safe/handler.test.ts):
  unauthenticated caller, non-coach caller, archived team, `coaches` population,
  plus every row of the reconciliation table including the
  `ConditionalCheckFailedException` → `protectedCount` race case (Major 3) and
  a double-invocation idempotency test (Major 4).
- **Component tests** for `CalendarFeedSettings` (link, sync, error display,
  archived-team hiding) and the updated `Home.tsx` cards (cancelled badge,
  unverified-home/away badge, `pendingCreatedGames` absorbing sync results).
- **E2E smoke:** upload a fixture `.ics`, assert the games appear on the home
  schedule.
- `npm run gate:commit` green before each commit.

## Risks and open questions

Updated after architecture review round 1 (see the "Approved as designed" /
"Required plan changes" list that closed that review, folded into the
sections above).

1. ~~Provider allowlist vs. generic feeds~~ — **resolved**: host allowlist for
   the URL path (security item 7), since file upload already covers arbitrary
   providers.
2. **Auto-apply with a heuristic parser.** Decision 3 means a misparsed opponent
   or a flipped home/away lands in the data with no human check. Mitigation
   (revised): the PlayMetrics adapter is confident enough to set `isHome`
   directly; the generic adapter now has an explicit fallback (`isHome: false`
   plus `externalHomeAwayUnverified: true` plus a warning) rather than "the
   existing default" — `isHome` has no schema default to fall back to. Worth
   confirming the fallback value and the unverified-badge UX are acceptable.
3. **The feed URL is a bearer credential.** Revised per architecture review
   Major 1: it no longer lives on `Team` (broadcast to every screen via
   `observeQuery`) — it lives in the new isolated `CalendarFeed` model, queried
   only by the settings panel. Still DynamoDB-encrypted-at-rest and scoped by
   `ownersDefinedIn('coaches')`; every coach on a shared team can still read
   it, same as any other shared-team data. Acceptable; noted.
4. **`X-WR-CALNAME` may not end in " Games"** on other PlayMetrics feed types.
   The alias is stored and editable, so a wrong guess is correctable, not fatal.
5. **Deleted-from-feed games linger** (reconciliation table, last row) — accepted
   gap, needs a feed-window concept to close, deferred.
6. **`externalCancelled` games are not filtered from `GamePlanner` or
   `SeasonReport`** (architecture review Minor). A cancelled-but-`scheduled`
   game still appears in both today. Accepted as a v1 gap rather than expanding
   this change's file list into the planner/report — flagged for a follow-up
   if it proves confusing in practice. Play time and rotation data are
   otherwise untouched by import: imported games are plain `scheduled` games
   with no other interaction with `PlayTimeRecord` or `GamePlan`.
7. **Unlink semantics** (architecture review Minor): unlinking deletes the
   `CalendarFeed` row and clears the `Team` status fields; `Game.external*`
   fields on already-imported games are preserved untouched, so a future
   re-link re-matches by `externalUid` instead of creating duplicates.
8. **DST wall-time rule, decided** (was open in the original draft): a
   nonexistent spring-forward wall time is shifted forward by the gap; an
   ambiguous fall-back wall time uses the earlier (pre-transition) offset.
   `arriveByTime` is resolved against the event's own local date and TZID, and
   a parsed arrive-by that lands after `DTSTART` is dropped with a warning
   rather than stored, since that pattern indicates a misparsed description
   line rather than a real arrive-by time.
9. **Retrofitting the five existing handlers onto the new `shared/teamAccess.ts`
   / `shared/dynamo.ts` helpers** (architecture review Major 6) is explicitly
   out of scope for this change — noted as a follow-up, not attempted here, to
   avoid touching already-audited authz code as a side effect of an unrelated
   feature.
