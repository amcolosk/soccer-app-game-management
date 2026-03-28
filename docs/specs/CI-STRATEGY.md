# CI Strategy

## 1. Goals

- **Minute budget ≤ 3,000 / month** — every trigger type has a baseline cost and the workflow is structured to stay within that envelope.
- **Single required status check** — branch protection requires exactly one check (`CI Policy Gate`); no per-job names are added.
- **All tests run before or at merge** — full E2E executes on `merge_group` and `push main`; smoke E2E runs on trusted PRs that touch risk paths or carry the label.
- **No credentials in the repository** — AWS secrets are never stored in code or `amplify_outputs.json`; they are fetched at runtime from SSM via OIDC.
- **Layered timeout hard-stops** — Playwright timeouts, `maxFailures`, and GitHub Actions `timeout-minutes` combine to kill stalled jobs before budget overrun.

---

## 2. Workflow File

**File:** `.github/workflows/ci.yml`

**Triggers:**

| Trigger | Filter |
|---------|--------|
| `pull_request` | `branches: [main]` |
| `merge_group` | _(all)_ |
| `push` | `branches: [main]` |
| `workflow_dispatch` | _(manual, no inputs)_ |

**Required branch-protection status:** `CI Policy Gate` is the **only** required check. No individual job names (`quality`, `smoke-e2e`, `full-e2e`) are added to branch protection.

---

## 3. Job Pipeline

### Dependency diagram

```
calc-mode ──┬──────────────────────────────────────────────┐
            │                                               │
            ▼                                               ▼
       detect-risk ──► smoke-e2e ◄── quality ──► full-e2e
                                         │            │
                                         └────────────┤
                                                       ▼
                                              ci-policy-gate
```

> `ci-policy-gate` depends on all five upstream jobs and runs with `if: always()`.

### Job table

| Job | Purpose | `timeout-minutes` |
|-----|---------|:-----------------:|
| `calc-mode` | Compute deterministic mode outputs (`is_trusted_pr`, `is_mainline`, `full_label`, `smoke_label`, etc.) from event context | 5 |
| `detect-risk` | Run `dorny/paths-filter` on PRs to emit `e2e_risk` when risk paths changed | 5 |
| `quality` | Checkout → install → legacy-config guard → lint → typecheck → unit tests → build | 20 |
| `smoke-e2e` | Smoke E2E with CI stub config; runs on trusted PRs that have risk paths or the `run-smoke-e2e` label | 25 |
| `full-e2e` | Full E2E with SSM-fetched config via OIDC; runs on mainline (`merge_group` / `push main`) or trusted PR with `run-full-e2e` label | 45 |
| `ci-policy-gate` | Always-run gate: evaluates required-by-context outcomes and fails if any required job did not pass | 10 |

---

## 4. Context Truth Table

| Event | Trusted? | Secret-backed E2E? | Required E2E level | Gate passes when |
|-------|----------|-------------------|-------------------|-----------------|
| `pull_request` — fork | No | No | None | `quality` passes |
| `pull_request` — same-repo, no label, no risk paths | Conditionally yes | No | None | `quality` passes |
| `pull_request` — same-repo, `run-smoke-e2e` label **or** risk paths changed | Yes | No | Smoke | `quality` + `smoke-e2e` pass |
| `pull_request` — same-repo, `run-full-e2e` label | Yes | Yes | Full E2E | `quality` + `full-e2e` pass |
| `pull_request_target` | Forbidden | No | None (not triggered) | Workflow does not fire; `full-e2e` contains an explicit guard that exits 1 if somehow reached |
| `merge_group` | Yes | Yes | Full E2E | `quality` + `full-e2e` pass |
| `push` — `main` | Yes | Yes | Full E2E | `quality` + `full-e2e` pass |
| `workflow_dispatch` | Yes | Yes | Full E2E | `quality` + `full-e2e` pass |

> **Note:** `workflow_dispatch` is classified as mainline (`is_mainline=true`), so full E2E runs for any manual dispatch. Its primary use is manually triggering the full pipeline from any branch.

---

## 5. Smoke vs Full E2E

### Smoke spec files

The `smoke-e2e` job runs exactly two spec files:

```
e2e/auth.spec.ts
e2e/team-management.spec.ts
```

### Path changes that trigger auto-smoke

The `detect-risk` job uses `dorny/paths-filter`. A change to any of the following paths sets `e2e_risk=true`, which causes smoke to run on trusted PRs even without a label:

```
src/**
amplify/**
e2e/**
playwright.config.ts
vite.config.ts
package.json
package-lock.json
.github/workflows/ci.yml
```

### Amplify config source

| Job | Config source | How delivered |
|-----|--------------|---------------|
| `quality` | `amplify_outputs.ci.json` | Committed CI stub; copied to `amplify_outputs.json` before lint/build |
| `smoke-e2e` | `amplify_outputs.ci.json` | Same committed stub; no real credentials |
| `full-e2e` | SSM parameter | Fetched at runtime via OIDC → SSM; written to `amplify_outputs.json`; deleted in `if: always()` cleanup step |

---

## 6. Runtime Amplify Config Delivery

### OIDC → SSM fetch flow

1. `full-e2e` requests `id-token: write` at the job level (not at workflow level).
2. `aws-actions/configure-aws-credentials@v4` exchanges the OIDC token for temporary AWS credentials by assuming `secrets.AWS_ROLE_TO_ASSUME`.
3. The job reads `vars.AMPLIFY_OUTPUTS_SSM_PARAMETER` and aborts if the variable is empty.
4. `aws ssm get-parameter --with-decryption` writes the parameter value to `amplify_outputs.json`.
5. A `jq` validation step asserts required keys (`version`, `auth.user_pool_id`, `auth.aws_region`, `data.url`, `data.aws_region`, `storage.bucket_name`) before tests start.
6. An `if: always()` cleanup step runs `rm -f amplify_outputs.json` regardless of test outcome.

### Required repo secrets and variables

| Name | Kind | Purpose |
|------|------|---------|
| `AWS_ROLE_TO_ASSUME` | Secret | ARN of the IAM role the OIDC token assumes |
| `AWS_REGION` | Variable | AWS region (defaults to `us-east-1` if unset) |
| `AMPLIFY_OUTPUTS_SSM_PARAMETER` | Variable | Full SSM parameter path, e.g. `/teamtrack/ci/e2e/amplify-outputs` |

### IAM trust policy constraints

The role's trust policy restricts assumption to specific OIDC subject claim patterns:

```json
{
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
    },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": [
        "repo:amcol/soccer-app-game-management:ref:refs/heads/main",
        "repo:amcol/soccer-app-game-management:ref:refs/heads/release/*",
        "repo:amcol/soccer-app-game-management:environment:ci-e2e"
      ]
    }
  }
}
```

Fork PRs, untrusted branches, and non-matching owners cannot assume the role.

### Least-privilege permissions

| Action | Resource |
|--------|---------|
| `ssm:GetParameter` (allow) | `arn:aws:ssm:REGION:ACCOUNT:parameter/teamtrack/ci/e2e/*` |
| `secretsmanager:GetSecretValue` (allow, if needed) | `arn:aws:secretsmanager:REGION:ACCOUNT:secret:teamtrack/ci/e2e/*` |
| `kms:Decrypt` (allow) | `arn:aws:kms:REGION:ACCOUNT:key/KMS_KEY_ID` |
| `ssm:PutParameter` (explicit deny) | `*` |
| `secretsmanager:PutSecretValue` (explicit deny) | `*` |
| `kms:Encrypt` (explicit deny) | `*` |

---

## 7. Playwright Configuration

**Canonical config path:** `playwright.config.ts` (repo root)

**Legacy path guard:** The `quality` job runs a `git grep` check for the string `e2e/playwright.config.ts` across the entire repository. If any match is found, the job fails immediately. This prevents drift back to the legacy path.

All `npm run test:e2e*` scripts in `package.json` explicitly pass `--config=playwright.config.ts`.

### Anti-hang timeout stack (CI)

| Layer | Setting | CI value | Source |
|-------|---------|----------|--------|
| GitHub job hard stop | `timeout-minutes` | 55 min (full E2E), 20 min (smoke) | `ci.yml` |
| Playwright global cap | `globalTimeout` | 45 min | `playwright.config.ts` |
| Per-test timeout | `timeout` | 90 sec | `playwright.config.ts` |
| Assertion timeout | `expect.timeout` | 15 sec | `playwright.config.ts` |
| Action timeout | `actionTimeout` | 15 sec | `playwright.config.ts` |
| Navigation timeout | `navigationTimeout` | 30 sec | `playwright.config.ts` |
| Dev server startup | `webServer.timeout` | 120 sec | `playwright.config.ts` |
| Fast-fail threshold | `maxFailures` | 5 | `playwright.config.ts` |

> The job `timeout-minutes` is the outermost hard stop, firing if Playwright's `globalTimeout` somehow fails to terminate the process.

---

## 8. Concurrency and Minute Governance

### Concurrency configuration

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' || (github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main') }}
```

Pull request runs and non-main `workflow_dispatch` runs cancel superseded runs on the same ref. Mainline runs (`merge_group`, `push main`) queue normally and are not cancelled.

### Budget model

| Trigger type | Runs / week | Min / run | Weekly baseline | Monthly baseline |
|-------------|:-----------:|:---------:|:---------------:|:----------------:|
| `pull_request` quality only (default) | 42 | 7 | 294 | 1,176 |
| `pull_request` smoke E2E (trusted, labeled or risk path) | 6 | 12 | 72 | 288 |
| `merge_group` full E2E | 8 | 22 | 176 | 704 |
| `push main` full E2E (post-merge) | 4 | 20 | 80 | 320 |
| `workflow_dispatch` quality only | 1 | 20 | 20 | 80 |
| **Total** | | | **642** | **2,568** |

Planned monthly total: **2,568 minutes** — 432 minutes headroom under the 3,000-minute budget.

### Downgrade thresholds

| Threshold | Condition | Action |
|-----------|-----------|--------|
| Warning (85%) | `utilization ≥ 85%` or `monthly_projection ≥ 3,000` | Force PRs to quality-only unless `run-full-e2e` or `run-smoke-e2e` label is present |
| Action (90%) | `utilization ≥ 90%` | Disable PR smoke-e2e; preserve mainline full E2E |
| Emergency (95%) | `utilization ≥ 95%` | Keep full E2E on `merge_group` and `push main` only; `workflow_dispatch` requires explicit maintainer opt-in |
| Recovery | Two consecutive weeks with weekly burn ≤ 600 | Restore one downgrade level per qualifying week |

---

## 9. Branch Protection Setup

1. Open **Settings → Branches → Branch protection rules** on `main`.
2. Enable **Require status checks to pass before merging**.
3. Search for and add exactly one status check: **`CI Policy Gate`**.
4. Enable **Require branches to be up to date before merging**.
5. Save the rule.

> **Warning:** Do **not** add `quality`, `smoke-e2e`, `full-e2e`, or any other individual job names as required checks. Those jobs are conditionally skipped depending on context; adding them as required checks will permanently block PRs where the jobs are intentionally skipped.

---

## 10. Adding New E2E Tests

### Adding to the full suite

Place the new spec file in `e2e/` following the existing naming convention (`<feature>.spec.ts`). The `full-e2e` job runs `npx playwright test --config=playwright.config.ts` without a file filter, so new specs are automatically included.

### Adding to the smoke subset

The smoke subset is an explicit file list in the `smoke-e2e` job step:

```yaml
- name: Run smoke E2E suite
  run: npx playwright test --config=playwright.config.ts e2e/auth.spec.ts e2e/team-management.spec.ts
```

To include a test in smoke, add its spec file path to this command. Keep the smoke set small — its purpose is fast signal on the most critical paths within the 20-minute job budget.

---

## 11. Operator Runbook

| Situation | Resolution |
|-----------|-----------|
| Need E2E signal on a PR without risky path changes | Add the `run-smoke-e2e` label to the PR. Smoke runs automatically on re-push or re-run. |
| Need a quick smoke confirmation on any PR | Add `run-smoke-e2e` label. Remove it after the check to avoid unnecessary future runs. |
| Force full E2E on a specific PR | Add the `run-full-e2e` label to the PR (same-repo only). `full-e2e` runs with SSM-backed config. |
| SSM config is outdated (stale `amplify_outputs.json` in parameter) | Update the SSM parameter value via AWS Console or CLI: `aws ssm put-parameter --name <PARAM> --value "$(cat amplify_outputs.json)" --overwrite`. Re-run the failed workflow. |
| CI job hangs near its `timeout-minutes` limit | Check whether the dev server failed to start (`webServer.timeout` is 120 sec) or a test is stuck in a retry loop (`retries: 2`). Inspect the Playwright HTML report artifact. Reduce `maxFailures` or add a `globalTimeout` guard if tests are consistently timing out. |
| Monthly budget near 90% | Apply **Action** downgrade: remove the `run-smoke-e2e` auto-trigger from PRs (label-driven only) or temporarily reduce the expected run frequency. Monitor for two consecutive low-burn weeks before restoring normal mode. |
