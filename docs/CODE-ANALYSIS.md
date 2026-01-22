# Code Analysis & Security Tools

This document describes the code analysis and security tools integrated into the TeamTrack project.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run knip` | Find unused code, files, and dependencies |
| `npm run knip:fix` | Auto-remove unused exports |
| `npm run lint` | Run ESLint with security checks |
| `npm audit` | Check for dependency vulnerabilities |

---

## 1. Knip - Dead Code Detection

**Purpose:** Finds unused files, exports, dependencies, and types in the codebase.

### Usage

```bash
# Check for unused code (report only)
npm run knip

# Auto-fix: remove unused exports
npm run knip:fix
```

### What It Detects

| Category | Description |
|----------|-------------|
| **Unused files** | Source files not imported anywhere |
| **Unused dependencies** | npm packages in package.json not used in code |
| **Unused devDependencies** | Dev packages not used by tooling |
| **Unused exports** | Exported functions/variables never imported |
| **Unused exported types** | TypeScript types/interfaces never used |

### Configuration

Configuration is in `knip.json`:

```json
{
  "entry": ["src/main.tsx", "amplify/**/*.ts"],
  "project": ["src/**/*.{ts,tsx}", "amplify/**/*.ts"],
  "ignore": ["**/*.test.ts", "**/*.spec.ts", "e2e/**/*", "dist/**/*"],
  "ignoreDependencies": ["aws-lambda", "@aws-sdk/client-cognito-identity-provider"]
}
```

### Handling False Positives

If knip reports something as unused that is actually needed:

1. **For dependencies used by Lambda functions:** Add to `ignoreDependencies` in `knip.json`
2. **For entry points:** Add to `entry` array in `knip.json`
3. **For test files:** Already ignored via `ignore` patterns

---

## 2. ESLint Security Plugin

**Purpose:** Catches common security anti-patterns in JavaScript/TypeScript code.

### Usage

```bash
# Run ESLint with security checks
npm run lint
```

Security rules are automatically included via `plugin:security/recommended-legacy`.

### Rules Enabled

| Rule | Severity | Description |
|------|----------|-------------|
| `detect-unsafe-regex` | error | Catches RegEx vulnerable to ReDoS attacks |
| `detect-non-literal-fs-filename` | warn | Path traversal vulnerabilities |
| `detect-eval-with-expression` | error | Prevents `eval()` with dynamic input |
| `detect-child-process` | warn | Command injection via child_process |
| `detect-non-literal-regexp` | warn | Dynamic RegExp injection |
| `detect-no-csrf-before-method-override` | error | CSRF vulnerabilities |
| `detect-possible-timing-attacks` | warn | Timing attack vulnerabilities |
| `detect-pseudoRandomBytes` | error | Weak random number generation |
| `detect-object-injection` | off | Disabled (too many false positives with TypeScript) |

### Configuration

Configuration is in `.eslintrc.cjs`:

```javascript
extends: [
  // ... other configs
  'plugin:security/recommended-legacy',
],
plugins: ['security'],
rules: {
  'security/detect-object-injection': 'off',
},
```

---

## 3. npm audit - Dependency Vulnerabilities

**Purpose:** Checks for known security vulnerabilities in npm dependencies.

### Usage

```bash
# Check for vulnerabilities
npm audit

# Auto-fix safe updates
npm audit fix

# Fix including major version updates (may break things)
npm audit fix --force
```

### Interpreting Results

- **Low:** Minor issues, fix when convenient
- **Moderate:** Should be addressed soon
- **High/Critical:** Fix immediately

### Handling Unfixable Vulnerabilities

Some vulnerabilities are in transitive dependencies and can't be directly fixed:

1. Check if an update to the parent dependency fixes it
2. Consider using `npm-force-resolutions` for critical issues
3. Document accepted risks if no fix is available

---

## CI/CD Integration

Consider adding these checks to your CI/CD pipeline:

```yaml
# Example GitHub Actions step
- name: Code Analysis
  run: |
    npm run lint
    npm run knip
    npm audit --audit-level=high
```

---

## Periodic Maintenance

| Frequency | Task |
|-----------|------|
| Weekly | Run `npm audit` and review new vulnerabilities |
| Before PR merge | Run `npm run lint` and `npm run knip` |
| Monthly | Review knip output and clean up unused code |
| Quarterly | Update dependencies and run full security audit |
