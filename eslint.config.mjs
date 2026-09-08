/**
 * The lint rules, and why there are so few of them.
 *
 * Prettier already decides how the code looks and TypeScript already decides
 * whether it is correct, so a large rule set here would mostly be a third
 * opinion about things two tools have settled. What is left is the narrow band
 * neither of them covers: **identifiers that resolve to something other than
 * what the author meant**.
 *
 * That band is not theoretical. `external` was declared in a component's props
 * type and never destructured, so the body read `window.external` - a legacy
 * object every browser still exposes, and therefore truthy. Every link in the
 * sidebar got `target="_blank"`, so clicking a resource opened a second tab
 * and loaded the whole admin again. TypeScript accepted it because `lib.dom`
 * declares `external` as a global, which is exactly the hole this file closes.
 *
 * So: no stylistic rules, no opinions about arrow bodies or import order. One
 * class of bug, caught before it ships.
 */
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import typescript from 'typescript-eslint'

/**
 * Browser globals with names an author is likely to have meant as a local.
 *
 * Every one of these is a real property of `window`, so an undeclared
 * identifier of that name resolves silently instead of failing - and most of
 * them are truthy, which is what turns a missing destructure into behaviour
 * rather than a crash.
 */
const AMBIGUOUS_GLOBALS = [
  { name: 'external', message: 'window.external. Did you mean a prop or a local?' },
  { name: 'name', message: 'window.name. Did you mean a prop or a local?' },
  { name: 'length', message: 'window.length. Did you mean a prop or a local?' },
  { name: 'status', message: 'window.status. Did you mean a prop or a local?' },
  { name: 'event', message: 'window.event. Take the event as a parameter.' },
  { name: 'origin', message: 'window.origin. Did you mean a prop or a local?' },
  { name: 'top', message: 'window.top. Did you mean a prop or a local?' },
  { name: 'self', message: 'window.self. Did you mean a prop or a local?' },
  { name: 'parent', message: 'window.parent. Did you mean a prop or a local?' },
  { name: 'closed', message: 'window.closed. Did you mean a prop or a local?' },
  { name: 'opener', message: 'window.opener. Did you mean a prop or a local?' },
  { name: 'screen', message: 'window.screen. Did you mean a prop or a local?' },
  { name: 'frames', message: 'window.frames. Did you mean a prop or a local?' },
  { name: 'history', message: 'window.history. Did you mean a prop or a local?' },
  { name: 'scrollbars', message: 'window.scrollbars. Did you mean a prop or a local?' },
]

export default typescript.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'examples/*/dist/**',
      'examples/*/prisma/**',
    ],
  },

  js.configs.recommended,
  ...typescript.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-restricted-globals': ['error', ...AMBIGUOUS_GLOBALS],

      // Hooks called conditionally are a correctness bug, not a style. Its
      // sibling `exhaustive-deps` warns rather than fails: the two places that
      // depart from it did so deliberately and say why, and a rule that fails
      // the build for a judgement call is a rule people disable wholesale.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      /*
       * Everything below is turned *off*, deliberately.
       *
       * The recommended sets carry opinions this repository has already
       * settled elsewhere, and a linter that reports two hundred things
       * nobody intends to change is a linter people stop reading.
       */
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        // A parameter named to document a signature is not a mistake; one
        // assigned and never read usually is.
        { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
