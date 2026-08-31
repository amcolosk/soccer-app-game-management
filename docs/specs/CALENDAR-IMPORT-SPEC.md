# Calendar Import — Provider Adapter Spec

Records the PlayMetrics `.ics` description grammar this feature's parser was
built against, so a future adapter author (for a different provider, or a
PlayMetrics format change) is not re-deriving it from a sample file. Full
feature design: [docs/plans/CALENDAR-FEED-GAME-IMPORT-PLAN.md](../plans/CALENDAR-FEED-GAME-IMPORT-PLAN.md).

Source code: `amplify/functions/shared/ical/parser.ts` (generic RFC-5545
core) and `amplify/functions/shared/ical/adapters/` (provider-specific
interpretation). Test fixture: `amplify/functions/shared/ical/__fixtures__/playmetrics-sample.ics`,
reconstructed from a real feed's traps — see that plan's "Parsing the real
feed — the traps" section. The live feed URL is never committed anywhere in
this repo (it is a bearer credential — see the plan's Goal section and
Security requirements).

## Adapter selection

`amplify/functions/shared/ical/adapters/index.ts`'s `selectAdapter` picks a
provider adapter by sniffing the calendar-level `PRODID` property
(case-insensitive substring match). Anything that doesn't match a known
provider falls back to the generic adapter. To add a new provider:

1. Add a new file under `adapters/` implementing the `Adapter` interface
   (`detect`, `parseEvent`) from `adapters/types.ts`.
2. Register it in `selectAdapter`, tried before the generic catch-all.
3. Add it to the security section's host allowlist
   (`amplify/functions/sync-team-calendar/fetchFeed.ts`) if it will be
   fetched by URL, not just uploaded as a file.

## RFC-5545 core (provider-agnostic)

- **Line unfolding** happens before anything else: a folded line is a CRLF
  (or bare LF, tolerated) immediately followed by exactly one space or tab,
  which is stripped and the two physical lines joined. Consuming zero or two
  characters corrupts values that happen to fold mid-word.
- **Escape sequences** (`\n`/`\N`, `\,`, `\;`, `\\`) are resolved *after*
  unfolding, never before — they are a property-value-level concept
  distinct from the physical line fold.
- **DTSTART** resolves to a UTC ISO string via `resolveDateTimeToUtcIso`:
  - `...Z` suffix → used directly as UTC.
  - A `TZID=<zone>` parameter → resolved via `zonedWallTimeToUtc`, which
    uses `Intl.DateTimeFormat` (no date library dependency; Node 22 ships
    full ICU).
  - Floating (no `Z`, no `TZID`) → falls back to the calendar's
    `X-WR-TIMEZONE`, then UTC.
  - DST boundary rule: a nonexistent spring-forward wall time is shifted
    forward by the gap; an ambiguous fall-back wall time uses the earlier
    (pre-transition/DST) offset.
- **`RRULE`** on a `VEVENT` is not evaluated — out of scope for v1 (games
  don't recur); the event is still imported once, with a warning.
- **Caps** (DoS hardening): 2,000 `VEVENT`s, 100,000 unfolded lines, 10,000
  chars per property value — see `parser.ts`'s `MAX_*` constants.

## PlayMetrics adapter grammar

Detected via `PRODID:-//PlayMetrics//EN`.

### `SUMMARY` is not useful

Every event's `SUMMARY` is the team's own name plus `" - Game"` — identical
for every event in the feed. Opponent, home/away, and venue all come from
`DESCRIPTION`, not `SUMMARY`.

### Identifying "us"

Derived from the calendar-level `X-WR-CALNAME` by stripping a trailing
`" Games"` suffix (case-insensitive), e.g. `"Iowa United FC U13 Boys Navy
Games"` → `"Iowa United FC U13 Boys Navy"`. This alias is persisted to
`Team.calendarFeedTeamAlias` on the **first successful URL-path sync only**
— a later sync never overwrites it, so a coach's correction (the TeamTrack
team name need not match the feed's) survives.

### Home/away and opponent (`DESCRIPTION` line 1)

The first line of `DESCRIPTION` is prose in the form `<away team> at <home
team>`:

- If it **starts with** `"<us> at "`, we're away; opponent is everything
  after that prefix.
- If it **ends with** `" at <us>"`, we're home; opponent is everything
  before that suffix.
- Do **not** naively split on the first `" at "` — team names can
  legitimately contain the substring `" at "` themselves (e.g. `"Team A at
  Home"`).
- If neither pattern matches (unrecognized alias, or the description
  doesn't follow this grammar), fail safe the same way the generic adapter
  does: `isHome: false`, `externalHomeAwayUnverified: true`, and a warning —
  never guess.

### Arrive-by time (`DESCRIPTION` line 2, when present)

`"Arrive by 2:45 PM"` — parsed against the *same calendar date and TZID* as
the event's own `DTSTART`. If the parsed time lands at or after kickoff,
it's dropped with a warning rather than stored — that pattern indicates a
misparsed description line, not a real arrive-by time.

### Venue (`DESCRIPTION` line 3, when present, vs. `LOCATION`)

- When a third description line exists, it is the venue **name** (e.g.
  `"Martin Field 1"`), and the `LOCATION` property is the street **address**
  (e.g. `"3740 86th St., Urbandale, IA 50322"`).
- When only two description lines exist (no venue-name line), the venue name
  comes from `LOCATION` instead, and there is no separate address at all.
- Never assume exactly three description lines — both two- and three-line
  events appear in the same real feed.

### Cancellation

`STATUS:CANCELLED` on the event, or `METHOD:CANCEL` at the calendar level,
both map to `cancelled: true`. Per the reconciliation rules, a cancelled
feed event **flags** the matching `Game` (`externalCancelled: true`); it is
never deleted.

## Generic adapter (fallback)

Used for any calendar whose `PRODID` doesn't match a known provider —
including the file-upload path with an unrecognized producer.

- `opponent` ← `SUMMARY`, trimmed; falls back to the literal `"Opponent
  TBD"` plus a warning if `SUMMARY` is empty (`opponent` is `.required()`
  with no schema default).
- `isHome` is always `false`, with `externalHomeAwayUnverified: true` and a
  warning — there is no generic way to detect home/away from an arbitrary
  feed's prose (`isHome` is likewise `.required()` with no default to fall
  back to).
- `locationName` ← `LOCATION` directly; no address, no arrive-by (a generic
  feed has no known description grammar to parse those from).

## Change detection

`externalContentHash` — a sha256 over the import-owned fields (opponent,
isHome, gameDate, locationName, locationAddress, arriveByTime) — drives
skip-vs-update, **not** `externalSequence`. `SEQUENCE` is optional in RFC
5545 and many producers (including some real-world PlayMetrics exports)
never increment it, so it cannot be trusted as a change signal on its own;
it is still recorded on `Game.externalSequence` for informational purposes.
