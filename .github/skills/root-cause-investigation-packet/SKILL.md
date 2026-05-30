---
name: root-cause-investigation-packet
description: "When bug root cause is inconclusive, add scoped debug instrumentation and produce a concrete investigation packet with commands, environment/data prerequisites, expected artifacts, and next actions. Use for blocked defect triage."
user-invocable: false
---

# Root Cause Investigation Packet

Use this skill when a defect cannot be confidently explained after reasonable analysis.

## Goal

- Make the unknowns observable with safe, targeted diagnostics.
- Provide a repeatable investigation packet so developers/reporters can gather decisive data.
- Keep issue state accurate without claiming a fix prematurely.
- Document interim recurrence defense while root cause remains inconclusive.

## Trigger Conditions

Apply when one or more are true:

- Reproducer is intermittent or environment-specific.
- Symptom observed but code-path ambiguity remains.
- Infrastructure or external dependency blocks local certainty.
- Multiple hypotheses remain plausible after initial debugging.

## Workflow

### 1. Record attempted hypotheses

Document:

- Hypotheses tested
- Evidence found
- Why each hypothesis is inconclusive or rejected

### 2. Add scoped diagnostics

Implement minimal, safe instrumentation:

- Use feature-flagged or narrowly scoped debug logs.
- Add correlation IDs or timestamps where ordering matters.
- Capture boundary values and state transitions.
- Avoid secrets, PII, tokens, and raw auth headers.
- Avoid permanent high-volume logs in hot paths.

### 3. Define collection procedure

Provide exact, copy-paste steps:

- Required branch/commit
- Environment prerequisites
- Seed/setup commands
- Repro commands
- Log/tracing capture commands
- Artifact export commands (if any)

### 4. Define expected artifacts

Specify exactly what to attach:

- Log files or filtered log snippets
- Test output and failing stack traces
- Network traces or screenshots when relevant
- Any generated IDs needed for cross-correlation

### 5. Define decision criteria

State what evidence would confirm or reject each remaining hypothesis.

### 6. Post investigation packet to issue

Include:

- Current status: blocked on investigation data
- What was attempted
- Current root cause confidence level
- Interim recurrence defense or containment in place
- What to collect
- Where to attach it
- Clear next owner/action

## Investigation Packet Template

- Status: Root cause inconclusive, investigation packet attached.
- Attempted hypotheses:
- H1: <summary> -> <result>
- H2: <summary> -> <result>
- Root cause confidence: <low/medium/high and why>
- Instrumentation added:
- <file/flag/log points>
- Interim defense/containment:
- <validation guard / feature flag / alert / operational runbook / none>
- Setup:
- <prereqs>
- Repro:
- <commands>
- Collect:
- <commands/artifacts>
- Attach here:
- <issue comment or artifact location>
- Decision rule:
- If <signal> then <hypothesis confirmed>; else <next step>

## Guardrails

- Do not mark issue fixed when root cause is unknown.
- Keep `status:in-progress` unless project policy says otherwise.
- Ensure diagnostics can be removed or disabled after investigation.
- If no interim defense is possible, state that explicitly and include risk impact.
