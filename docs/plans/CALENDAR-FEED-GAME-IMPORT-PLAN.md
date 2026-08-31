# Calendar Feed Game Import — Implementation Plan

**Status:** Revised after architecture review round 2 (approved) and UI review
round 1 (approved architecture; found four Major UI/UX gaps — dryRun had no UI
wiring, the adopted badge wasn't persisted, Unlink had no confirm step, no
loading/error states were specified — all folded in below)
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
- **A new minimal `CalendarFeed` model** holds the URL itself, keyed by
  `teamId` directly (no generated `id`, no `coaches` array, no relationship).

**Round-2 revision (architecture review Major A):** the first draft of this
model gave coaches direct client read/write access
(`ownersDefinedIn('coaches')`). That combination — client-writable rows the
Lambda then trusts by `teamId` alone — turned out to be exploitable (an
attacker who knows a team's id can plant a `CalendarFeed` row for it; the
victim coaches can't see or delete a row they're not listed on) and it
silently locked out co-coaches, because `accept-invitation`'s explicit
per-table `coaches` backfill list
([accept-invitation/handler.ts:307-326](../../amplify/functions/accept-invitation/handler.ts:307))
doesn't include a model this plan invents, so a newly-accepted coach's client
read of `CalendarFeed` comes back empty even though the team has a feed.

Revised design: **`CalendarFeed` is Lambda-only.** No client of any kind reads
or writes it directly.

```ts
CalendarFeed: a
  .model({
    teamId: a.id().required(),
    url: a.string().required(),
  })
  .identifier(['teamId'])   // one row per team, enforced by the key itself —
                             // not by application-level "check first" logic;
                             // precedent: BugReportRateLimit's custom
                             // identifier (resource.ts:398-409)
  .authorization((allow) => [allow.authenticated().to([])]),  // no client
                             // grants at all — precedent: same
                             // BugReportRateLimit model
```

The coach never sees the URL again once entered. `CalendarFeedSettings.tsx`
shows `Team.calendarFeedHost` (the display-only hostname) plus Replace/Unlink
actions, both of which go through the Lambda (see the new
`unlinkTeamCalendar` mutation below) — never a direct model read. This is
strictly better handling for a bearer credential than the round-1 design, not
just a bug fix: the client-side attack surface for the URL is now zero, and
"one feed per team" is a real key constraint instead of an
enforced-by-convention check.

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
externalAdoptedAt: a.datetime(),    // set once, when a hand-created game is
                                     // matched to a feed event (see
                                     // Reconciliation rules); never cleared.
                                     // UI review round 1: without a persisted
                                     // field, the "adopted" badge was scoped
                                     // to the single sync result and vanished
                                     // on reload — the one case where a
                                     // coach's own typed data was silently
                                     // overwritten would have had no durable
                                     // indicator on the game itself
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

**Idempotent id (architecture review Major 4):** `Game.id` for a
purely-new externally-sourced game (no existing row of any kind matches) is
not a fresh `randomUUID()`. It is deterministically derived from
`sha256(teamId + '|' + externalSource + '|' + externalUid)` so that two
concurrent sync invocations (double-tapped button, retried request, an
overlapping future scheduled sync) converge on the same id instead of
creating duplicates. Creates use `ConditionExpression: 'attribute_not_exists(id)'`,
which makes create itself idempotent for free. Hand-created games keep random
ids; **this id scheme applies only when a genuinely new row is being created —
see "Adopting hand-created games" below for the case where an existing
hand-entered game is matched and updated in place instead, which keeps its
original random id.**

**Exact derivation, pinned (round-2 Minor 2 — this is a persisted wire
contract, not an implementation detail; a later change to the recipe orphans
every previously-imported game and re-creates it as a duplicate):** take the
sha256 hex digest of `teamId + '|' + externalSource + '|' + externalUid`, use
its first 32 hex characters, and format as `8-4-4-4-12` with the version
nibble forced to `4` and the variant nibble forced into `8`–`b` (standard
UUIDv4 shaping, applied to hash output rather than random bytes — the goal is
a valid-looking `a.id()` string, not cryptographic randomness). Implemented in
`contentHash.ts` with a golden test asserting the exact output for a fixed
input triple, so a future refactor can't silently change the recipe.

**Backfill:** none needed. All fields are optional; existing games have them null.

**GSI:** a `gamesByExternalUid` index is *not* added in v1, matching Finding 10
— the sync Lambda lists the team's games via the same paginated `ScanCommand` +
`FilterExpression` pattern every other multi-record handler already uses, and
matches in memory. This is a real per-sync full-table scan, not "tens of
games" — acceptable for manual, per-team sync today; the Phase 5 risk section
below records it as a scheduled-sync scaling dependency.

### `amplify/data/resource.ts` — `Team`

```ts
calendarFeedProvider: a.string()
  .authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
calendarFeedTeamAlias: a.string()
  .authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
calendarFeedHost: a.string()          // display-only hostname, e.g. "calendar.playmetrics.com" — never the full URL
  .authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
calendarFeedLastSyncedAt: a.datetime()
  .authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
calendarFeedLastError: a.string()
  .authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
```

All five are Lambda-written, coach-**read**-only status fields (round-2 fix,
architecture review Major B — the round-1 draft left them writable by any
coach, matching neither the `archivedAt`/`archivedBy` precedent it cited nor
intent). **The feed URL itself does not live here** (architecture review Major
1): see the new `CalendarFeed` model, now specified above under Derived
Decision A as Lambda-only.

### New mutations

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
    saveFeedUrl: a.boolean(), // persist feedUrl as this team's CalendarFeed row
    dryRun: a.boolean(),      // parse + reconcile, return the result, write nothing
  })
  .returns(a.ref('CalendarSyncResult'))
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(syncTeamCalendar)),

unlinkTeamCalendar: a
  .mutation()
  .arguments({ teamId: a.string().required() })
  .returns(a.boolean())
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(unlinkTeamCalendar)),
```

`unlinkTeamCalendar` is a small dedicated Lambda mirroring the
`archiveTeam`/`restoreTeam` pattern of one purpose-specific function per
action, rather than overloading `syncTeamCalendar` with an unlink mode. It
runs `assertTeamAccess`, then deletes the team's `CalendarFeed` row and clears
the five `Team` status fields. `Game.external*` fields on already-imported
games are untouched (see Risks — Unlink semantics).

`CalendarSyncResult` (architecture review Major 2 — counts alone are not
enough, because SDK writes don't trigger AppSync subscriptions and the UI has
no other way to learn what was written):

```ts
CalendarSyncResult: a.customType({
  createdGames: a.ref('Game').array(),   // full Game objects, complete enough
  updatedGames: a.ref('Game').array(),   // for direct GraphQL serialization —
                                          // see "Returned Game objects must be
                                          // complete" below (round-2 Minor 1)
  skippedCount: a.integer(),
  cancelledCount: a.integer(),
  adoptedCount: a.integer(),   // hand-created games matched and linked to a
                                // feed event instead of duplicated — see
                                // Reconciliation rules, round-2 Major D
  protectedCount: a.integer(),
  failedCount: a.integer(),
  warnings: a.string().array(),
}),
```

`dryRun` lets the first-link flow show "this will create 12 games, update 2"
without a separate preview code path — the reconciliation logic runs
identically, the write step is just skipped.

**Returned `Game` objects must be complete (round-2 Minor 1):** the generated
`Game` type has non-null `createdAt`/`updatedAt`; a handler-constructed object
missing them fails GraphQL serialization. Creates follow
[create-game-safe/handler.ts:77-94](../../amplify/functions/create-game-safe/handler.ts:77)
(`__typename`, `createdAt`, `updatedAt` included). Updates use
`ReturnValues: 'ALL_NEW'` on the `UpdateCommand` (precedent:
[assign-team-owner/handler.ts:63,87](../../amplify/functions/assign-team-owner/handler.ts:63))
and return that, rather than reconstructing the object from the pre-update
read plus the applied `SET`.

**`feedUrl`/`saveFeedUrl` now that `CalendarFeed` is Lambda-only (round-2
revision of this paragraph — Major A removed the client-write path it
originally described):** there is no direct `client.models.CalendarFeed` call
anywhere in the frontend. `feedUrl`/`saveFeedUrl` on `syncTeamCalendar` are the
*only* way a `CalendarFeed` row is created or replaced: pass `feedUrl` to sync
against a URL not yet saved, and `saveFeedUrl: true` to have the Lambda persist
it in the same round trip. Omitting `feedUrl` re-syncs whatever `CalendarFeed`
row the Lambda already has for the team. Unlinking goes through the separate
`unlinkTeamCalendar` mutation above, not this one.

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
| `amplify/functions/unlink-team-calendar/resource.ts` + `handler.ts` *(new)* | Small dedicated Lambda, `archiveTeam`/`restoreTeam`-shaped: `assertTeamAccess`, delete the team's `CalendarFeed` row, clear the five `Team` status fields. |
| `amplify/data/resource.ts` | New `Game` fields, new `Team` fields (field-level `.to(['read'])`), new Lambda-only `CalendarFeed` model, `CalendarSyncResult` custom type, `syncTeamCalendar` and `unlinkTeamCalendar` mutations. |
| `amplify/backend.ts` | Register both functions. **Corrected grants (round-2 Major B — the round-1 draft's grant list didn't match what the handlers actually do and would fail at runtime with `AccessDenied`):** on the Game table, `dynamodb:Scan` + `dynamodb:PutItem` + `dynamodb:UpdateItem` (not `Query` — no GSI exists, per Major 5); on the Team table, `dynamodb:GetItem` **and** `dynamodb:UpdateItem` (the round-1 grant list omitted the write the Lambda actually needs to persist `calendarFeedLastSyncedAt` etc.); on the CalendarFeed table, `dynamodb:GetItem` (valid now that it's keyed by `teamId` directly — see Derived Decision A) plus `dynamodb:PutItem` / `dynamodb:UpdateItem` (`sync-team-calendar`) and `dynamodb:DeleteItem` (`unlink-team-calendar`). Set `GAME_TABLE`, `TEAM_TABLE`, `CALENDAR_FEED_TABLE` env vars on both functions. Keep the least-privilege `addToRolePolicy` style used for `createGameSafe`, not `grantReadWriteData`. |

### Frontend

| File | Change |
|---|---|
| `src/services/calendarSyncService.ts` *(new)* | Thin wrapper over `client.mutations.syncTeamCalendar` and `client.mutations.unlinkTeamCalendar`, using `assertMutationResult` like [gameService.ts](../../src/services/gameService.ts). No `client.models.CalendarFeed.*` calls anywhere — that model has no client grants (Major A). |
| `src/components/Home.tsx` | Owns the sync entry point from **Phase 2 onward** (round-2 fix — see Phasing; this was contradictorily assigned to `CalendarFeedSettings.tsx` in round 1 while that component was also stated not to trigger sync). **CTA hierarchy (UI review round 1 Major):** the existing full-width `.btn-primary` "+ Schedule New Game" ([Home.tsx:625-633](../../src/components/Home.tsx:625)) stays the sole primary CTA — it's what the onboarding Quick Start Checklist points at by name (UI-SPEC.md:778). The calendar action is **one slot, relabeled by state**, not two competing buttons: secondary-weight (not `.btn-primary`) "Import from calendar" (opens the file picker; Phase 2) becomes "Sync now" once a feed is saved (Phase 3+), with a small "or upload a file instead" fallback alongside it once a feed exists. See "Sync interaction flow" under Reconciliation rules for the preview/confirm/loading/error states this button drives. Also: show venue and arrive-by on scheduled game cards; badge feed-cancelled (`externalCancelled`) and unverified home/away (`externalHomeAwayUnverified`) games using the existing pill-badge convention (`.location-badge`/`.status-badge`, `App.css:1606-1630`) rather than the plain-text `.game-status` style, with a **priority rule** so a card shows at most one state-badge: cancelled beats unverified-home/away (a cancelled game's home/away accuracy is moot). The durable adopted indicator (`externalAdoptedAt != null`, a small "linked from your entry" tag rather than a warning-style badge) can co-occur with either, since it's provenance information, not a warning. |
| `src/components/CalendarFeedSettings.tsx` *(new, ships Phase 3+)* | Team-settings panel, mounted in `Management.tsx`: link a URL feed (calls `syncTeamCalendar` with `feedUrl` + `saveFeedUrl: true`), Replace, and read-only status display (`calendarFeedHost`, last synced, last error) sourced entirely from `Team` fields — **never reads the URL back**, because nothing can (Major A). **Unlink routes through `useConfirm`/`ConfirmModal`** (UI review round 1 Major — the only destructive action in this codebase's set of comparable actions that lacked one), consistent with delete-game and every other irreversible action. Hidden for archived teams via the existing `ArchivedTeamBanner` component (`src/components/shared/ArchivedTeamBanner.tsx`, UI review round 1 Minor — already used by `SeasonReport` and in-game views for exactly this). Doesn't exist meaningfully before Phase 3, since Phase 2 hard-rejects `feedUrl` and there is no saved-feed concept yet. |
| `src/components/Management.tsx` | Mount `CalendarFeedSettings` in the team edit view (Phase 3+). |
| `src/App.css` | New section appended at the bottom (per CLAUDE.md) for the settings panel, the preview modal (slide-up sheet per UI-SPEC §8), and the cancelled/unverified/adopted/imported pill badges. |

### Docs

`docs/ARCHITECTURE.md` gets a Calendar Import section, and a new
`docs/specs/CALENDAR-IMPORT-SPEC.md` records the PlayMetrics description grammar
so a future adapter author is not re-deriving it from a sample file.

**Post-merge correction:** this original Docs entry missed the two app-wide
spec docs the feature actually made stale — [README.md](../../README.md)'s
Features list and Data Model summary, and
[docs/specs/UI-SPEC.md](../specs/UI-SPEC.md)'s Home/Manage screen sections and
Modal Patterns. Both were updated after the fact rather than as part of the
original plan. `plan-writer` and `architect-reviewer` now explicitly check for
this class of gap (README.md/UI-SPEC.md coverage) on every future plan, and
`validation-reviewer`/`ui-reviewer` check for it again post-implementation as
a backstop — see the corresponding `.claude/agents/*.md` updates alongside
this note.

## Reconciliation rules (Decision 3, precisely)

**Matching precedence, in order:**

1. **By `externalUid` + `externalSource` + `teamId`** (architecture review
   Minor — `externalSource` added to prevent a cross-provider UID collision if
   a team ever switches feeds). This is the primary match, for games already
   synced at least once.
2. **By adoption** (round-2 Major D, only when step 1 finds nothing): a
   hand-created game (`externalUid == null`) on the same team whose `gameDate`
   is within ±3 hours of the parsed event's `gameDate` is treated as the same
   game entered by hand before the feed was linked.
3. Otherwise, no match — this is a genuinely new game.

Change detection compares `externalContentHash`, not `externalSequence`
(Major 7b, see Schema changes).

| Existing game | Feed says | Action |
|---|---|---|
| none (no match at any precedence step) | active | **create** — id = deterministic hash (Major 4), `ConditionExpression: attribute_not_exists(id)`, `coaches` from team, `status: 'scheduled'` |
| adopted match (step 2), any content | active | **adopt** — `UpdateCommand` stamping `externalUid`/`externalSource`/`externalContentHash`/`externalAdoptedAt: now()` plus the import-owned fields onto the *existing* row, **keeping its original random id** (not the deterministic one — see Schema changes). Reported in `updatedGames`, `adoptedCount` incremented, and a warning added ("linked to an existing game you entered by hand") so the coach isn't surprised their hand-entered game just changed. Same `ConditionExpression: '#status = :scheduled'` guard as any other update. `externalAdoptedAt` is set once and never cleared — see the badge note under Schema changes. |
| `status === 'scheduled'`, same content hash (step-1 match) | active | **skip** (no write) |
| `status === 'scheduled'`, changed content hash (step-1 match) | active | **update** — `UpdateCommand` with an explicit `SET` of only the import-owned attributes (never `PutCommand` — a full overwrite would clobber `elapsedSeconds`/`lastStartTime`/`ourScore`/`currentHalf`), `ConditionExpression: '#status = :scheduled AND attribute_exists(id)'` |
| `status !== 'scheduled'` | anything | **protect** — no write attempted at all (checked before issuing the conditional update) |
| `status === 'scheduled'` | cancelled | `UpdateCommand` setting `externalCancelled: true` only, same conditional guard, **never delete** |
| exists, absent from feed | — | **leave alone** (feed windows are partial; absence is not cancellation) |

**Why adoption matters (round-2 Major D):** the plan's own stated motivation
is a coach who has been hand-entering games. Without adoption, that coach's
first link duplicates every game they already entered that also appears in
the feed — the primary onboarding path, not an edge case. `dryRun` surfaces
this in the preview ("3 existing games will be linked, 9 new games created")
before the coach commits.

**Read-then-write race (architecture review Major 3):** the Lambda lists games
via `scanAll` before writing, so a coach could start a game between the scan
and the write. Every update, adopt, and cancel-flag write above carries
`ConditionExpression: '#status = :scheduled'`; a `ConditionalCheckFailedException`
on that condition is caught and counted as `protectedCount`, not surfaced as
`failedCount` or an error — the same gap `assignTeamOwner` already closes with
a conditional write on its own status check.

Games created by hand that don't match any feed event (by uid or by adoption
window) are never touched. The "absent from feed" rule is deliberate and worth
flagging to review: a genuinely deleted game will linger. Detecting that
safely needs a feed-window concept (min/max `DTSTART` in the payload) —
deferred, and called out as a known gap.

### Sync result display (round-2 Major C)

`pendingCreatedGames` in `Home.tsx` is **addition-only** —
[Home.tsx:130-136](../../src/components/Home.tsx:130) filters it down to
entries whose id isn't already in the live `games` list. An *updated* game's
id is already present, so an overlay entry for it would be silently dropped
and the stale card would keep rendering — the round-1 draft asserted this
mechanism would "absorb" updates, which isn't accurate for the update case.
Two different mechanisms for two different results:

- **`createdGames`** (brand-new games, ids not yet in `games`): absorbed by
  `pendingCreatedGames`, identically to how `createGameSafe` already uses it.
- **`updatedGames`** (existing ids, including adopted games): the overlay
  can't help here. Instead, the sync handler in `Home.tsx` bumps
  `gameRefreshKey` immediately after a successful mutation — the same
  mechanism `Home.tsx` already uses on focus/visibility change
  ([Home.tsx:159-192](../../src/components/Home.tsx:159)) to force
  `observeQuery` to re-settle. This is a forced refetch, not a merge; there is
  no attempt at an id-keyed overlay override for updates.

### Sync interaction flow: preview, confirm, loading, error (UI review round 1)

Four gaps the plan left unspecified: `dryRun` had no described UI trigger despite
being framed as protecting the adoption/onboarding scenario; the interaction
model for "Import from calendar" and "Sync now" wasn't defined at all;
`unlinkTeamCalendar` had no confirm step, unlike every other destructive action
in this codebase (`useConfirm`/`ConfirmModal`, e.g.
[Home.tsx:569-575](../../src/components/Home.tsx:569)); and there was no
loading/error state model for a mutation whose Lambda has a 60s timeout. One
concrete flow resolves all four:

1. **Trigger** — coach taps "Import from calendar" (Phase 2: file picker;
   Phase 3+: same slot relabeled "Sync now" once a feed is saved — see CTA
   placement below, this is one action, not two competing ones). Button enters
   a busy state ("Checking…"), disabled to prevent a double-tap, mirroring the
   existing `isSubmittingGame` pattern
   ([Home.tsx:669-671](../../src/components/Home.tsx:669)).
2. **Preview (`dryRun: true`)** — the mutation runs once with `dryRun: true`.
   - If the result is a no-op (`createdGames`/`updatedGames`/`adoptedCount`/
     `cancelledCount` all zero — the common case for a routine re-sync with
     nothing changed), skip straight to a lightweight success toast ("No
     changes — schedule already up to date") with no modal. Avoids modal
     fatigue on repeat "Sync now" taps, which is otherwise the dominant case
     once a feed is linked.
   - Otherwise, show a preview modal (slide-up sheet, matching `RotationWidget`'s
     pattern per UI-SPEC §8) summarizing the counts in plain language — "This
     will create 9 games, update 2, and link 3 games you already entered by
     hand" — plus the `warnings` list, with Confirm and Cancel actions. This is
     the concrete surface for the adoption-preview scenario the plan's
     Reconciliation section already frames as the primary onboarding
     protection; without this modal that framing had nothing behind it.
3. **Commit** — Confirm re-runs the same mutation without `dryRun` (same
   `feedUrl`/`icsContent`/`saveFeedUrl` arguments). The modal's Confirm button
   shows its own busy state ("Applying…") while this runs. On success: close
   the modal, absorb `createdGames`/`updatedGames` per "Sync result display"
   above, and show a success toast with the final counts. Cancel simply closes
   the modal — no mutation, no team-state change, matching `dryRun`'s
   write-nothing contract.
4. **Error handling** — a thrown mutation error (network failure, Lambda
   timeout, a client-side-rejected oversized file per the 512 KB cap) surfaces
   via the existing `react-hot-toast` pattern already used elsewhere in this
   app, with plain-language copy per file type (parse failure, timeout, file
   too large) rather than a raw error message. The trigger button and modal
   Confirm button both re-enable on failure so the coach can retry.
5. **Unlink** (Phase 3+) — routes through `useConfirm`/`ConfirmModal`, the same
   pattern already used for delete-game and other destructive actions in this
   codebase, before calling `unlinkTeamCalendar`. No dry-run needed here (the
   effect — stop syncing, clear status fields, leave existing games alone — is
   fully described by the confirm copy itself).

**Phase 2 needs the preview modal too, not just Phase 3+**: adoption logic and
`dryRun` both ship in Phase 2 (file-upload path), so the preview/confirm flow
is part of that phase's scope, not deferred UI polish.

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
   - Schema: `Game` fields, `Team` fields (read-only for coaches), the
     Lambda-only `CalendarFeed` model, `CalendarSyncResult`, the
     `syncTeamCalendar` mutation. `feedUrl` and `saveFeedUrl` arguments are
     **hard-rejected** by the handler in this phase (not silently ignored) —
     no client should be able to depend on pre-hardening URL-fetch behavior
     before Phase 3 exists. `unlinkTeamCalendar` isn't needed yet either
     (nothing can be linked until Phase 3) — it ships with Phase 3.
   - Reconciliation, including the cancelled-flag write and the
     hand-created-game adoption logic, ships complete — it's the same code
     path as everything else in this phase.
   - `Home.tsx` gets the "Import from calendar" entry point (round-2 fix —
     moved here from `CalendarFeedSettings.tsx`/`Management.tsx`, which don't
     exist yet in this phase), **including the preview-modal
     (`dryRun`)/confirm/loading/error flow** specified under "Sync interaction
     flow" above (UI review round 1 — this isn't deferred polish, it's the
     concrete surface for the adoption-preview scenario this phase's
     reconciliation logic already implements) and the `externalCancelled`
     pill badge on game cards, shipping **in this phase**, not Phase 4, so
     cancelled-flagged data is never displayed as a normal scheduled game.
   - This ships a genuinely useful feature with **no SSRF surface at all**.
3. **Hardened URL fetch, saved feed, Sync now.** The security section applies
   entirely to this phase, including the host allowlist. `unlinkTeamCalendar`
   and `CalendarFeedSettings.tsx` (mounted in `Management.tsx`, Unlink behind a
   confirm modal) ship here, since a saved feed is the first thing this phase
   makes possible. `Home.tsx`'s existing entry point relabels itself "Sync
   now" once a feed is saved, reusing the same preview/confirm/loading/error
   flow from Phase 2 rather than introducing a second one.
4. **UI polish** — venue and arrive-by on cards, the unverified-home/away
   pill badge and the durable adopted-game indicator (`externalAdoptedAt`).
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
  `ConditionalCheckFailedException` → `protectedCount` race case (Major 3), a
  double-invocation idempotency test (Major 4), and the adoption path (Major D
  — a hand-created game within the ±3h window gets adopted, not duplicated;
  one outside the window does not).
- **Golden test for the deterministic-id derivation** (round-2 Minor 2): fixed
  `teamId`/`externalSource`/`externalUid` input, exact expected UUID-shaped
  output, asserted byte-for-byte so a future refactor can't silently change
  the recipe and orphan every previously-imported game.
- **`CalendarFeed` authorization tests** (round-2 Major A): a non-coach caller
  cannot read or write a `CalendarFeed` row through any client-facing API —
  there should be no such API to test against, which is itself the assertion
  (confirm the generated client has no `client.models.CalendarFeed`).
- **`unlinkTeamCalendar` handler tests**: unauthenticated caller, non-coach
  caller, archived team, and the happy path — `CalendarFeed` row deleted,
  `Team` status fields cleared, `Game.external*` fields on existing games
  untouched.
- **Component tests** for `CalendarFeedSettings` (link, replace, unlink behind
  `useConfirm`/`ConfirmModal`, error display, archived-team hiding via
  `ArchivedTeamBanner` — asserting it never issues a `client.models.CalendarFeed`
  call) and the updated `Home.tsx` cards (cancelled pill badge, unverified-home/away
  pill badge, durable adopted indicator surviving a reload, badge priority —
  cancelled suppresses unverified-home/away on the same card,
  `pendingCreatedGames` absorbing `createdGames`, `gameRefreshKey` bumping on
  `updatedGames`).
- **Sync interaction flow tests** (UI review round 1): a no-op `dryRun` (all
  counts zero) skips the preview modal and shows the lightweight toast; a
  non-empty `dryRun` result shows the preview modal with correct counts and
  warnings; Confirm re-runs without `dryRun` and absorbs results; Cancel makes
  no mutation call at all; the trigger button and modal Confirm button both
  disable during their respective in-flight requests (double-tap guard); a
  thrown error re-enables both and shows a toast with the failure-appropriate
  copy (network, timeout, oversized file, parse failure).
- **E2E smoke:** upload a fixture `.ics`, assert the games appear on the home
  schedule.
- `npm run gate:commit` green before each commit.

## Risks and open questions

Updated after architecture review rounds 1 and 2 and UI review round 1 (see
each review's findings, folded into the sections above). Architecture review
round 2 approved the architecture and found four Majors in round 1's *fixes
themselves* (a client-writable `CalendarFeed` model, a grant list that didn't
match the handlers, an overlay mechanism that doesn't absorb updates, and no
story for hand-entered games) — all resolved above; per that review's own
assessment these were localized schema/plan edits, so no round 3 was run
(2-round loop cap). UI review round 1 approved the architecture as UI-neutral
and found four Majors purely in the UI specification (no `dryRun` UI trigger,
a non-durable adopted badge, no confirm on Unlink, no loading/error state
model) plus two Minors (badge visual convention, naming the existing
`ArchivedTeamBanner`) — all resolved above via the new "Sync interaction flow"
subsection and the schema/file-table edits.

1. ~~Provider allowlist vs. generic feeds~~ — **resolved**: host allowlist for
   the URL path (security item 7), since file upload already covers arbitrary
   providers.
2. **Auto-apply with a heuristic parser.** Decision 3 means a misparsed opponent
   or a flipped home/away lands in the data with no human check. Mitigation
   (revised twice): the PlayMetrics adapter is confident enough to set `isHome`
   directly; the generic adapter has an explicit fallback (`isHome: false` plus
   `externalHomeAwayUnverified: true` plus a warning) rather than "the existing
   default" — `isHome` has no schema default to fall back to. UI review round 1
   added the actual human check Decision 3's "no approval screen" otherwise
   left missing for the *first* sync against a linked feed or file: the
   `dryRun` preview modal (see "Sync interaction flow") surfaces counts and
   warnings before anything is written, for any sync with a non-zero result.
   Routine re-syncs that would show a no-op preview skip the modal, so this
   doesn't reintroduce an approval screen for the steady state — only for
   syncs that actually change something.
3. **The feed URL is a bearer credential.** Revised twice: round 1 (Major 1)
   moved it off `Team` into an isolated `CalendarFeed` model with coach read
   access; round 2 (Major A) found that coach-readable model was itself
   exploitable (a caller who knows a `teamId` could plant a row the real
   coaches couldn't see or remove) and made `CalendarFeed` **Lambda-only** —
   no client, coach or otherwise, can read or write it at all. This also
   closes what would have been a separate gap (round-2 Minor 3): a coach
   removed via `revokeCoachAccess` can no longer retain standing read access
   to the credential, because there's no client read path for anyone to
   retain. DynamoDB-encrypted-at-rest as always; the URL now only ever exists
   inside the Lambda's execution and the DynamoDB row it writes.
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
7. **Unlink semantics** (architecture review Minor, mechanism revised in
   round 2 to go through the dedicated `unlinkTeamCalendar` Lambda rather than
   a client delete that no longer exists; UI review round 1 added the
   `useConfirm`/`ConfirmModal` step before the coach can trigger it):
   unlinking deletes the `CalendarFeed` row and clears the `Team` status
   fields; `Game.external*` fields on already-imported games are preserved
   untouched, so a future re-link re-matches by `externalUid` instead of
   creating duplicates.
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
   feature. Both new Lambdas introduced in round 2 (`sync-team-calendar` and
   `unlink-team-calendar`) use these shared helpers from the start.
10. **Adoption's ±3-hour matching window is a heuristic** (round-2 Major D): a
    hand-entered game whose date was mistyped by more than 3 hours won't be
    adopted and will duplicate instead. Accepted for v1 — `dryRun` surfaces
    the resulting duplicate count before the coach commits, and a duplicate is
    a `deleteGameSafe` away from cleanup, which is materially better than
    silently merging two different games because a window was too generous.
