#!/usr/bin/env node
// Compares the built JS bundle size against a recorded baseline, so a
// Tier 1+ change (see docs/COORDINATOR-WORKFLOW-EVALUATION.md) gets a
// deterministic signal on bundle growth instead of relying on a reviewer to
// eyeball it. Run `npm run build` first.
//
// Usage:
//   node scripts/check-bundle-size.mjs                 # check against baseline
//   node scripts/check-bundle-size.mjs --update-baseline  # record new baseline

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS_DIR = join('dist', 'assets');
const BASELINE_PATH = '.bundle-size-baseline.json';
const GROWTH_THRESHOLD = 0.15; // 15%

function getJsBundleBytes() {
  if (!existsSync(ASSETS_DIR)) {
    console.error(`${ASSETS_DIR} not found — run "npm run build" first.`);
    process.exit(1);
  }
  let total = 0;
  for (const entry of readdirSync(ASSETS_DIR)) {
    if (entry.endsWith('.js')) {
      total += statSync(join(ASSETS_DIR, entry)).size;
    }
  }
  return total;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function toKb(bytes) {
  return (bytes / 1024).toFixed(1);
}

function main() {
  const updateBaseline = process.argv.includes('--update-baseline');
  const currentBytes = getJsBundleBytes();

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ jsBundleBytes: currentBytes }, null, 2)}\n`);
    console.log(`Baseline updated: ${toKb(currentBytes)} KB`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.log(`No baseline found at ${BASELINE_PATH}. Current JS bundle size: ${toKb(currentBytes)} KB.`);
    console.log('Run with --update-baseline to record this as the baseline.');
    process.exit(0);
  }

  const growth = (currentBytes - baseline.jsBundleBytes) / baseline.jsBundleBytes;
  const growthPct = (growth * 100).toFixed(1);
  console.log(
    `JS bundle size: ${toKb(currentBytes)} KB (baseline ${toKb(baseline.jsBundleBytes)} KB, ${growth >= 0 ? '+' : ''}${growthPct}%)`,
  );

  if (growth > GROWTH_THRESHOLD) {
    console.error(`Bundle grew more than ${(GROWTH_THRESHOLD * 100).toFixed(0)}% versus baseline.`);
    console.error('If this growth is expected, re-run with --update-baseline to accept the new size.');
    process.exit(1);
  }

  process.exit(0);
}

main();
