---
name: workflow-contract-checklist
description: "Enforce cross-agent workflow contract consistency: required output sections, blocked-state behavior, ask-user gating, stage handoff completeness, and commit-gate command policy."
user-invocable: false
---

# Workflow Contract Checklist

Use this skill for any agent response that participates in the coordinator-managed pipeline.

## Goal

- Keep stage progression deterministic and auditable.
- Prevent incomplete handoffs and ambiguous blocked states.
- Standardize what every stage must return.

## Required Output Sections

Every participating agent response must include all sections below:

- Status: success | needs-revision | blocked | failed
- Findings
- Artifacts
- Required Next Step
- Handoff Prompt

If any section is missing, treat the response as incomplete and restate.

## Blocked-State Rules

When blocked on missing user input:

- Set `Status: blocked`
- Set `Required Next Step: ask-user`
- Include `Questions for User:`
- Ask only minimum non-obvious questions required to proceed

Do not continue to later stages while blocked.

## Stage-Handoff Checklist

Before handing off, ensure:

- Current stage is explicitly identified
- Requirements and constraints are restated succinctly
- Relevant files/paths are listed
- Risks and assumptions are called out
- Success criteria for next stage are explicit

## Commit-Gate Policy

Use `npm run gate:commit` as the canonical local commit-gate command.

- Do not request separate lint/test/build commands unless troubleshooting a failing gate step.
- Include concise pass/fail evidence in artifacts.

## Response Quality Rules

- Keep findings actionable and verifiable.
- Separate blocking vs non-blocking concerns clearly.
- Avoid vague wording (for example, "probably fixed").
- Prefer concrete file/test/command references.
