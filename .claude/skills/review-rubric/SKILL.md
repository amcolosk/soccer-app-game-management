---
name: review-rubric
description: Shared severity rubric and blocking rules for architect-reviewer, ui-reviewer, validation-reviewer, and security-reviewer. Load this before writing findings so severity is consistent across reviewers.
---

# Review severity rubric

Rate every finding at one severity. Don't invent extra levels or hedge between two.

- **Critical** — data loss, security exploit, broken auth, or the change doesn't do what it claims to do at all. Always blocks.
- **Major** — will cause an incorrect result, regression, or a real security/UX gap for a realistic user path. Blocks progression to the commit gate.
- **Minor** — a real but narrow-impact issue (edge case, small inconsistency, missed simplification). Record it; don't block on it.
- **Informational** — worth knowing, no action required (style preference, future consideration).

Every finding needs concrete evidence: a `file:line` reference and, for Major/Critical, the specific failure scenario (input/state → wrong output). "This could be a problem" without a scenario is not a finding — leave it out or downgrade to Informational.

## Blocking rule

Only Major and Critical findings block progression. When you report one, the coordinating thread routes it to `coding-agent` for a fix and re-runs **you specifically** on that fix — not the whole review, and not the other reviewers.

## Re-review rule

On a re-review, only report:

1. Findings that are still unresolved from last round, or
2. New problems the fix itself introduced.

Do not re-open a Minor/Informational item you already recorded, and do not re-litigate a Major finding the fix already addressed just because you'd have solved it differently. If you disagree with how it was fixed, that disagreement is only a new finding if the fix leaves a real Major/Critical defect behind — say what's still broken, not what you'd have preferred.

This rule exists specifically to stop fix→re-review cycles from running forever: each round must shrink the open finding list, never just reshuffle it.
