/**
 * setup-amplify-outputs.mjs
 *
 * Ensures amplify_outputs.json exists before the build step.
 * If the real file is already present (local dev / deployed env) this script
 * is a no-op.  When it is absent (CI clone, fresh checkout) it copies the
 * committed CI stub so that `tsc && vite build` can resolve the import in
 * src/main.tsx without requiring real AWS credentials.
 */

import { copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const target = resolve(root, 'amplify_outputs.json');
const stub   = resolve(root, 'amplify_outputs.ci.json');

if (existsSync(target)) {
  console.log('[setup-amplify-outputs] amplify_outputs.json already exists – skipping.');
} else {
  if (!existsSync(stub)) {
    console.error('[setup-amplify-outputs] ERROR: amplify_outputs.ci.json not found. Cannot continue.');
    process.exit(1);
  }
  copyFileSync(stub, target);
  console.log('[setup-amplify-outputs] Created amplify_outputs.json from amplify_outputs.ci.json (CI stub).');
}
