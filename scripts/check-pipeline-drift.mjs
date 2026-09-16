#!/usr/bin/env node
// Heuristic check that the Claude Code and GitHub Copilot dev-pipeline
// definitions still describe the same stage sequence. The two files use
// different agent names for the same role by design (see CLAUDE.md), so this
// compares a canonicalized sequence of pipeline stages rather than exact
// text. It is intentionally non-required in CI (see docs/specs/CI-STRATEGY.md)
// — it flags drift for a human/reviewer to look at, it doesn't block merges.
//
// Usage: node scripts/check-pipeline-drift.mjs

import { readFileSync } from 'node:fs';

const CLAUDE_CODE_FILE = '.claude/skills/dev-pipeline/SKILL.md';
const COPILOT_FILE = '.github/copilot-instructions.md';

// Both the Tier 2 (full pipeline) and Tier 1 (lean) sequences are checked —
// Tier 1 is the more commonly-exercised path, so drift there matters just as
// much as drift in the Tier 2 sequence.
const SEQUENCE_PAIRS = [
  {
    name: 'Tier 2 (high-risk)',
    claudeHeading: '## Stage sequence (Tier 2 — high-risk)',
    copilotHeading: '### New Feature Pipeline (Tier 2 — high-risk)',
  },
  {
    name: 'Tier 1 (standard)',
    claudeHeading: '## Stage sequence (Tier 1 — standard)',
    copilotHeading: '### Standard Pipeline (Tier 1)',
  },
];

// canonical stage name -> aliases used in each tool's pipeline files.
// 'coordinator-agent' is intentionally excluded: Claude Code has no separate
// coordinator subagent (the invoking thread owns state), so it only appears
// in the Copilot chain by design.
const ALIASES = [
  ['plan', ['plan-writer', 'implementation-planner']],
  ['architecture-review', ['architect-reviewer', 'architect-agent']],
  ['ui-review', ['ui-reviewer', 'ui-designer']],
  ['implement', ['coding-agent']],
  ['validation-review', ['validation-reviewer', 'validation-agent']],
  ['security-review', ['security-reviewer', 'security-engineer']],
  ['commit-gate', ['gate:commit', 'commit gate']],
];

function extractFencedBlockAfterHeading(content, filePath, heading) {
  const headingIndex = content.indexOf(heading);
  if (headingIndex === -1) {
    throw new Error(`Heading "${heading}" not found in ${filePath}`);
  }
  const rest = content.slice(headingIndex);
  const fenceMatch = rest.match(/```[a-z]*\n([\s\S]*?)```/);
  if (!fenceMatch) {
    throw new Error(`No fenced code block found after "${heading}" in ${filePath}`);
  }
  return fenceMatch[1];
}

function canonicalSequence(block) {
  const lower = block.toLowerCase();
  const occurrences = [];

  for (const [canonical, aliases] of ALIASES) {
    for (const alias of aliases) {
      const needle = alias.toLowerCase();
      let idx = lower.indexOf(needle);
      while (idx !== -1) {
        occurrences.push({ index: idx, canonical });
        idx = lower.indexOf(needle, idx + 1);
      }
    }
  }

  occurrences.sort((a, b) => a.index - b.index);

  const sequence = [];
  for (const occurrence of occurrences) {
    if (sequence[sequence.length - 1] !== occurrence.canonical) {
      sequence.push(occurrence.canonical);
    }
  }
  return sequence;
}

function main() {
  const claudeContent = readFileSync(CLAUDE_CODE_FILE, 'utf8');
  const copilotContent = readFileSync(COPILOT_FILE, 'utf8');

  let anyDrift = false;

  for (const pair of SEQUENCE_PAIRS) {
    const claudeBlock = extractFencedBlockAfterHeading(claudeContent, CLAUDE_CODE_FILE, pair.claudeHeading);
    const copilotBlock = extractFencedBlockAfterHeading(copilotContent, COPILOT_FILE, pair.copilotHeading);

    const claudeSeq = canonicalSequence(claudeBlock);
    const copilotSeq = canonicalSequence(copilotBlock);

    console.log(`${pair.name}:`);
    console.log(`  Claude Code pipeline:  ${claudeSeq.join(' -> ')}`);
    console.log(`  Copilot pipeline:      ${copilotSeq.join(' -> ')}`);

    const same = claudeSeq.length === copilotSeq.length && claudeSeq.every((stage, i) => stage === copilotSeq[i]);

    if (!same) {
      anyDrift = true;
      console.error(`  DRIFT: ${pair.name} sequences differ between the two tool variants.`);
    }
    console.log('');
  }

  if (anyDrift) {
    console.error(`Reconcile ${CLAUDE_CODE_FILE} and ${COPILOT_FILE}, or update this script's alias`);
    console.error('table in scripts/check-pipeline-drift.mjs if a stage was intentionally renamed.');
    process.exit(1);
  }

  console.log('Pipeline stage sequences match.');
  process.exit(0);
}

main();
