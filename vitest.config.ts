import { defineConfig } from 'vitest/config'

// A single root Vitest configuration drives the whole workspace. Each package
// contributes its own project; `architecture` is a root-level project holding
// the cross-package boundary checks, which by definition cannot live inside
// any one package.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      'packages/*',
      {
        test: {
          name: 'architecture',
          include: ['tests/**/*.test.ts'],
          passWithNoTests: false,
        },
      },
    ],
  },
})
