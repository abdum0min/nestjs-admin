/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],

  // A placeholder, not a real path. The mount point is chosen by the consuming
  // application at runtime (`AdminModule.forRoot({ path })`), which is long
  // after this build, so the asset URLs Vite emits absolute are rewritten when
  // the shell is served - see `renderShell` in packages/nestjs/src/ui/assets.ts.
  //
  // It is deliberately not a plausible value such as `/admin/`: a placeholder
  // that appears in the output for exactly one reason cannot be confused with
  // something that merely resembles it.
  //
  // Keep in step with `UI_BASE_PLACEHOLDER` in packages/nestjs/src/ui/assets.ts.
  base: '/__nest-admin-base__/',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The NestJS integration copies this directory into its own dist at
    // publish time; keep it self-contained.
    assetsDir: 'assets',
    sourcemap: true,
  },

  server: {
    port: 5173,
    proxy: {
      // The admin API lives at `/admin/meta` and `/admin/:model` - the same
      // path space this dev server uses for the app itself. Proxying `/admin`
      // would swallow the app's own HTML and assets, so development uses a
      // distinct prefix that is rewritten onto the real one. The client reads
      // it from `VITE_ADMIN_API_BASE`; in production the default `/admin` is
      // same-origin and needs no proxy at all.
      //
      // (The previous `/admin/api` proxy pointed at a path the API has never
      // served - it predates the Phase 3 routes.)
      '/__admin-api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__admin-api/, '/admin'),
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    passWithNoTests: true,
  },
})
