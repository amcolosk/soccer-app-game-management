---
name: handoff-prompt-builder
description: "Build concise, high-signal handoff prompts that preserve workflow context, risks, and exact next verification tasks."
user-invocable: false
---

# Handoff Prompt Builder

Use this skill when writing `Handoff Prompt` sections between agents/stages.

## Goal

- Reduce context loss between stages.
- Keep prompts concise while preserving execution-critical details.

## Handoff Template

Use this structure:

- Stage and objective
- Scope and key constraints
- Relevant files/surfaces
- Findings/risks to focus on
- Exact next action and success criteria

## Compact Prompt Skeleton

"Stage: <stage>. Objective: <goal>. Scope: <files/surfaces>. Constraints: <key constraints>. Known risks/findings: <bullets>. Next action: <what next agent must do>. Success criteria: <clear pass condition>."

## Quality Rules

- Prefer concrete nouns and verbs over generalities.
- Include only context needed for next stage decisions.
- Do not restate full history; summarize deltas.
- If blocked, include only minimum questions needed to unblock.
