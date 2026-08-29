/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],

  // The SPA is served by the consuming NestJS application under a base path,
  // `/admin` by default. Asset URLs are emitted absolute against that path.
  //
  // KNOWN LIMITATION: this hard-codes the mount point at build time, so a
  // developer who configures `path: '/backoffice'` would get broken asset
  // URLs. Making the base path configurable at runtime is an open decision
  // recorded in docs/architecture.md.
  base: '/admin/',

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
