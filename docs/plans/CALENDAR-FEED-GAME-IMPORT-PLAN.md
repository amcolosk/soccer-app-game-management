# Calendar Feed Game Import — Implementation Plan

**Status:** Draft — pending architecture review
**Date:** 2026-08-29

## Goal

Let a coach link an external team calendar (an iCalendar / `.ics` feed such as
PlayMetrics' published team calendar) to a TeamTrack team, and have TeamTrack
create and keep up to date the `Game` rows for that team's schedule — instead of
hand-entering every opponent, date, and home/away toggle in the
[Home.tsx](../../src/components/Home.tsx) create-game form.

Reference feed used to design the parser (real data, saved locally as
`games-calendar.ics`):
`https://calendar.playmetrics.com/calendars/c1294/t552627/p0/t511BFD1B/f/games-calendar.ics`

## Decisions locked with the product owner

| # | Question | Decision |
|---|---|---|
| 1 | Sync model | **Saved feed URL per team + manual "Sync now".** Built so a scheduled/background sync can be added later without rework. |
| 2 | Schema depth | **Dedupe key + venue.** New fields on `Game`; feed config on `Team`. |
| 3 | Re-sync semantics | **Auto-apply, protect live games.** No approval screen. Never mutate a game whose `status !== 'scheduled'`. Games cancelled in the feed are flagged, never deleted. |
| 4 | Parser scope | **Generic RFC-5545 core + pluggable provider adapters.** Ship the PlayMetrics adapter now. |

### Derived decision A: feed config lives on `Team`, not a new `CalendarFeed` model

Decision 2 rejected the separate-model option, but Decision 1 requires persisting
a feed URL somewhere. Resolution: **one feed per team**, stored as fields on
`Team`. This is a genuine constraint, not just an expedient one — a team has one
schedule. If multi-feed (e.g. league feed + tournament feed) is ever needed, the
fields promote cleanly to a `CalendarFeed` model with a `teamId`.

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
externalUid: a.string(),          // VEVENT UID, e.g. "Game_4841731"
externalSource: a.string(),       // 'playmetrics' | 'ics'
externalSequence: a.integer(),    // VEVENT SEQUENCE, for change detection
externalSyncedAt: a.datetime(),
externalCancelled: a.boolean(),   // feed says CANCELLED; game kept + flagged
locationName: a.string(),         // "Martin Field 1"
locationAddress: a.string(),      // "3740 86th St., Urbandale, IA 50322"
arriveByTime: a.datetime(),       // parsed from "Arrive by 2:45 PM"
```

None carry `.default()`, sidestepping Finding 4. Field-level grants restrict the
`external*` fields to `['read']` for coaches (Lambda writes bypass field auth by
going through the SDK), matching the `archivedAt` / `archivedBy` precedent.
`locationName`, `locationAddress`, and `arriveByTime` stay coach-writable so a
coach can correct a venue by hand.

**Backfill:** none needed. All fields are optional; existing games have them null.

**GSI:** a `gamesByExternalUid` index is *not* added in v1. The sync Lambda
already lists the team's games (needed anyway to apply the protection rules) and
matches in memory; a team has tens of games, not thousands.

### `amplify/data/resource.ts` — `Team`

```ts
calendarFeedUrl: a.string(),
calendarFeedProvider: a.string(),     // 'playmetrics' | 'ics'
calendarFeedTeamAlias: a.string(),    // name used to identify "us" in the feed
calendarFeedLastSyncedAt: a.datetime(),
calendarFeedLastError: a.string(),
```

`calendarFeedUrl` is coach-writable (they paste it); the rest are Lambda-written
and coach-readable. **The URL is credential-bearing** — the PlayMetrics path
segment `t511BFD1B` is an unguessable token that grants read access to the
schedule. It must never be logged, echoed in an error message, or sent to
analytics.

### New mutation

```ts
syncTeamCalendar: a
  .mutation()
  .arguments({
    teamId: a.string().required(),
    feedUrl: a.string(),      // provided when linking or re-syncing a URL feed
    icsContent: a.string(),   // provided when uploading a file
    saveFeedUrl: a.boolean(), // persist feedUrl on the team for future syncs
  })
  .returns(a.ref('CalendarSyncResult'))
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(syncTeamCalendar)),
```

with a custom type returning
`{ created, updated, skipped, cancelled, protected, warnings[] }` so the UI can
report "Imported 5 new games, updated 2" without a second fetch.

## Security requirements (must be in place before the URL path ships)

A Lambda fetching a user-supplied URL is a **server-side request forgery (SSRF)**
primitive. Non-negotiable controls:

1. **Scheme allowlist:** `https:` only. Reject `http:`, `file:`, `gopher:`, `data:`.
2. **Host validation:** resolve the hostname and reject any address in a private
   or special range — RFC1918, loopback, link-local (`169.254.0.0/16`, which
   covers the instance metadata endpoint `169.254.169.254`), CGNAT, IPv6 ULA and
   link-local, and IPv4-mapped IPv6 forms. Re-validate **after every redirect**;
   a pre-flight check alone is defeated by a redirect.
3. **Redirect cap:** at most 3, each re-validated. Never follow a cross-scheme redirect.
4. **Response caps:** hard limit on `Content-Length` *and* on streamed bytes
   (256 KB), plus a 10 s timeout. Reject content types other than
   `text/calendar` / `text/plain`.
5. **Parser DoS caps:** max 2,000 `VEVENT`s, max 100,000 unfolded lines, max
   10,000 chars per property value. Bail with a clear error rather than looping.
6. **No URL in logs or errors.** Log a hash or the bare host. The stored
   `calendarFeedLastError` must be a sanitized message, since it is persisted and
   rendered back to the coach.
7. **A provider allowlist is worth considering for v1** (`calendar.playmetrics.com`
   plus a small set) — it collapses most of the SSRF surface. Flagged for the
   architecture and security reviewers as a scope call: safest option, but it
   caps the "generic ICS" promise of Decision 4 to the file-upload path.

Also note: `icsContent` from file upload skips the network controls entirely but
still needs every parser cap in (5). Imported opponent and venue strings are
rendered by React, which escapes by default — but any future
`dangerouslySetInnerHTML` or CSV/ICS *export* path would need re-checking.

## File-by-file changes

### Backend

| File | Change |
|---|---|
| `amplify/functions/shared/ical/parser.ts` *(new)* | RFC-5545 core: unfold, unescape, property and parameter parsing, VEVENT extraction, `zonedWallTimeToUtc`. Provider-agnostic. |
| `amplify/functions/shared/ical/adapters/playmetrics.ts` *(new)* | Description-prose parsing: opponent, home/away, venue, arrive-by. Detected via `PRODID:-//PlayMetrics//EN`. |
| `amplify/functions/shared/ical/adapters/generic.ts` *(new)* | Fallback: date, `SUMMARY` to opponent, `LOCATION` to venue; leaves `isHome` for the coach. |
| `amplify/functions/shared/ical/adapters/index.ts` *(new)* | Adapter selection by `PRODID` / `X-WR-*`. |
| `amplify/functions/sync-team-calendar/resource.ts` *(new)* | `defineFunction`, runtime 22, `timeoutSeconds: 60`, `resourceGroupName: 'data'`. |
| `amplify/functions/sync-team-calendar/handler.ts` *(new)* | Auth, team fetch (`ConsistentRead`), archived guard, fetch/validate, parse, reconcile, batch write. |
| `amplify/functions/sync-team-calendar/fetchFeed.ts` *(new)* | The hardened fetcher (all of the security section). Separated so it is unit-testable without the handler. |
| `amplify/data/resource.ts` | New `Game` fields, new `Team` fields, `CalendarSyncResult` custom type, `syncTeamCalendar` mutation. |
| `amplify/backend.ts` | Register the function; grant `dynamodb:PutItem` / `UpdateItem` / `Query` on the Game table and `GetItem` / `UpdateItem` on the Team table; set `GAME_TABLE` and `TEAM_TABLE` env vars. |

### Frontend

| File | Change |
|---|---|
| `src/services/calendarSyncService.ts` *(new)* | Thin wrapper over `client.mutations.syncTeamCalendar`, using `assertMutationResult` like [gameService.ts](../../src/services/gameService.ts). |
| `src/components/CalendarFeedSettings.tsx` *(new)* | Team-settings panel: URL input, Sync now, last-synced and last-error display, unlink, `.ics` file picker. Hidden for archived teams. |
| `src/components/Management.tsx` | Mount the settings panel in the team edit view. |
| `src/components/Home.tsx` | Show venue and arrive-by on scheduled game cards; badge feed-cancelled games; add an "Import from calendar" entry point next to the create form. |
| `src/App.css` | New section appended at the bottom (per CLAUDE.md) for the settings panel and the cancelled/imported badges. |

### Docs

`docs/ARCHITECTURE.md` gets a Calendar Import section, and a new
`docs/specs/CALENDAR-IMPORT-SPEC.md` records the PlayMetrics description grammar
so a future adapter author is not re-deriving it from a sample file.

## Reconciliation rules (Decision 3, precisely)

For each parsed event, match an existing game by `externalUid` + `teamId`:

| Existing game | Feed says | Action |
|---|---|---|
| none | active | **create** (via SDK, `coaches` from team, `status: 'scheduled'`) |
| `status === 'scheduled'`, same `SEQUENCE` | active | **skip** (no write) |
| `status === 'scheduled'`, newer `SEQUENCE` | active | **update** date, opponent, home/away, venue |
| `status !== 'scheduled'` | anything | **protect** — no write, counted as protected |
| `status === 'scheduled'` | cancelled | set `externalCancelled: true`, **never delete** |
| exists, absent from feed | — | **leave alone** (feed windows are partial; absence is not cancellation) |

Games created by hand (`externalUid == null`) are never touched. The
"absent from feed" rule is deliberate and worth flagging to review: a genuinely
deleted game will linger. Detecting that safely needs a feed-window concept
(min/max `DTSTART` in the payload) — deferred, and called out as a known gap.

## Phasing

1. **Parser and adapters, pure functions, no backend.** Highest test value, zero
   deployment risk. Test fixture is the real downloaded `.ics`.
2. **Schema fields plus `syncTeamCalendar` accepting `icsContent` only** (file
   upload path). Ships a genuinely useful feature with **no SSRF surface at all**.
3. **Hardened URL fetch, saved feed, Sync now.** The security section applies
   entirely to this phase.
4. **UI polish** — venue and arrive-by on cards, cancelled badges.
5. **Later, not now:** EventBridge scheduled sync. Phase 3's handler is written to
   take `(teamId)` and do everything else itself, so the scheduler becomes a new
   trigger over the same code, not a rewrite.

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
  a timeout, a wrong content type.
- **Handler tests** mirroring [create-game-safe/handler.test.ts](../../amplify/functions/create-game-safe/handler.test.ts):
  unauthenticated caller, non-coach caller, archived team, `coaches` population,
  plus every row of the reconciliation table.
- **Component tests** for `CalendarFeedSettings` (link, sync, error display,
  archived-team hiding) and the updated `Home.tsx` cards.
- **E2E smoke:** upload a fixture `.ics`, assert the games appear on the home
  schedule.
- `npm run gate:commit` green before each commit.

## Risks and open questions

1. **Provider allowlist vs. generic feeds** (security item 7) — needs a decision
   before Phase 3. Recommendation: allowlist for v1, since file upload already
   covers arbitrary providers.
2. **Auto-apply with a heuristic parser.** Decision 3 means a misparsed opponent
   or a flipped home/away lands in the data with no human check. Mitigation: only
   the PlayMetrics adapter is confident enough to set `isHome`; the generic
   adapter leaves it at the existing default for the coach to fix. Worth
   confirming that split is acceptable.
3. **The feed URL is a bearer credential** stored in DynamoDB. Encrypted at rest
   by default and scoped by `ownersDefinedIn('coaches')` — but every coach on a
   shared team can read it. Acceptable; noted.
4. **`X-WR-CALNAME` may not end in " Games"** on other PlayMetrics feed types.
   The alias is stored and editable, so a wrong guess is correctable, not fatal.
5. **Deleted-from-feed games linger** (reconciliation table, last row).
6. **Play time and rotation data are untouched** by import — imported games are
   plain `scheduled` games and flow into the existing planner unchanged. No
   interaction with `PlayTimeRecord` or `GamePlan`.
