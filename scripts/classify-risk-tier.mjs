#!/usr/bin/env node
// Classifies a change set into a dev-pipeline risk tier by inspecting which
// files changed against a base ref — see docs/COORDINATOR-WORKFLOW-EVALUATION.md
// and the "Risk tiers" section of .claude/skills/dev-pipeline/SKILL.md.
//
// Usage: node scripts/classify-risk-tier.mjs [--base <ref>]
// Exit code is always 0 — this is a classifier for the coordinating agent/dev
// to read, not a pass/fail gate.

import { execFileSync } from 'node:child_process';

// Any changed file matching one of these routes the whole change to Tier 2
// (high-risk), regardless of how small the diff is.
const HIGH_RISK_EXACT = [
  'src/utils/gameTimeUtils.ts',
  'src/utils/gameCalculations.ts',
  'src/utils/playTimeCalculations.ts',
  'src/services/rotationPlannerService.ts',
  'amplify/data/resource.ts',
  'amplify/backend.ts',
];
const HIGH_RISK_PREFIXES = ['amplify/auth/', 'amplify/functions/'];

function getChangedFiles(baseRef) {
  try {
    const remote = baseRef.includes('/') ? baseRef.split('/')[0] : 'origin';
    const branch = baseRef.includes('/') ? baseRef.split('/').slice(1).join('/') : baseRef;
    execFileSync('git', ['fetch', '--quiet', remote, branch], { stdio: 'ignore' });
  } catch {
    // Best effort — fall back to whatever refs are already available locally
    // (e.g. offline, or the ref is already up to date).
  }

  // Compare the working tree (committed + staged + unstaged) against the
  // merge-base with baseRef, so this reports the real risk of a change while
  // it's still in progress, not just what's already been committed.
  let diffFrom = baseRef;
  try {
    diffFrom = execFileSync('git', ['merge-base', baseRef, 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    // No merge base available (e.g. shallow clone, detached HEAD with no
    // shared history) — fall back to diffing directly against baseRef.
  }

  let tracked;
  try {
    const out = execFileSync('git', ['diff', '--name-only', diffFrom], { encoding: 'utf8' });
    tracked = out.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    // No usable ref at all — fall back to working-tree + staged changes
    // against HEAD (e.g. no base ref reachable).
    const out = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' });
    tracked = out.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  // `git diff` never reports untracked files (e.g. a brand-new module added
  // but not yet `git add`ed) — include those too, since a new high-risk file
  // should classify as Tier 2 just as much as an edit to an existing one.
  const untrackedOut = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });
  const untracked = untrackedOut.split('\n').map((line) => line.trim()).filter(Boolean);

  return [...new Set([...tracked, ...untracked])];
}

function isHighRisk(file) {
  if (HIGH_RISK_EXACT.includes(file)) return true;
  return HIGH_RISK_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isTrivial(file) {
  return file.startsWith('docs/') || file.endsWith('.md');
}

function classify(files) {
  if (files.length === 0) {
    return { tier: 0, reason: 'No changed files detected against the base ref.', matched: [] };
  }

  const matched = files.filter(isHighRisk);
  if (matched.length > 0) {
    return {
      tier: 2,
      reason: 'Touches high-risk path(s) — timer/play-time/rotation math, data model, or auth.',
      matched,
    };
  }

  if (files.every(isTrivial)) {
    return { tier: 0, reason: 'Docs/markdown-only change.', matched: [] };
  }

  return { tier: 1, reason: 'Standard change — no high-risk paths touched.', matched: [] };
}

function main() {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf('--base');
  const baseRef = baseIdx !== -1 ? args[baseIdx + 1] : process.env.RISK_TIER_BASE_REF || 'origin/main';

  const files = getChangedFiles(baseRef);
  const result = classify(files);

  console.log(`Risk tier: ${result.tier}`);
  console.log(`Reason: ${result.reason}`);
  if (result.matched.length > 0) {
    console.log('Matched high-risk paths:');
    for (const file of result.matched) console.log(`  - ${file}`);
  }
  if (files.length > 0) {
    console.log('');
    console.log(`Changed files vs ${baseRef} (${files.length}):`);
    for (const file of files) console.log(`  ${file}`);
  }

  process.exit(0);
}

main();
