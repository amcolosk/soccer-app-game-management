import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import security from 'eslint-plugin-security'

export default tseslint.config(
  // Global ignores (replaces ignorePatterns)
  { ignores: ['dist', 'dev-dist', 'eslint.config.js', '.amplify/**'] },

  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      security.configs.recommended,
    ],

    // Replaces --ext ts,tsx CLI flag
    files: ['**/*.{ts,tsx}'],

    languageOptions: {
      // ecmaVersion is ignored by the typescript-eslint parser; syntax support
      // comes from TypeScript itself. globals still applies.
      globals: globals.browser,
    },

    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },

    rules: {
      // Carry forward original react-hooks/recommended rules (v4 compat),
      // avoiding the v7 React Compiler rules that would introduce new failures
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Suppress false-positive from bracket notation (e.g. obj[key])
      'security/detect-object-injection': 'off',
    },
  },

  // Type-checked rules scoped to src/ (covered by tsconfig.json), excluding test files
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', {
        // async event handlers and subscription callbacks are valid patterns
        checksVoidReturn: { attributes: false, properties: false },
      }],
      '@typescript-eslint/await-thenable': 'error',
    },
  },

  // Node.js globals for Lambda functions, Playwright e2e tests, and build/config scripts
  {
    files: ['amplify/**/*.ts', 'e2e/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
)
