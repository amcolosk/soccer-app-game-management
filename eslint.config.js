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

  // Node.js globals for Lambda functions, Playwright e2e tests, and build/config scripts
  {
    files: ['amplify/**/*.ts', 'e2e/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
)
