import { defineConfig } from 'vitest/config'

// A single root Vitest configuration drives the whole workspace. Each project
// picks up its own `*.test.ts` files; there are no tests yet, so runs pass
// with `--passWithNoTests` semantics via `passWithNoTests: true`.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: ['packages/*', 'apps/*'],
  },
})
