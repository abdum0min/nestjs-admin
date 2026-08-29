import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],

  // The SPA is served by the consuming NestJS application under a base path,
  // `/admin` by default. Asset URLs are emitted absolute against that path.
  //
  // KNOWN LIMITATION: this hard-codes the mount point at build time, so a
  // developer who configures `path: '/backoffice'` would get broken asset
  // URLs. Making the base path configurable at runtime (a `<base href>` tag
  // injected by the NestJS static handler, or relative asset URLs plus a
  // router basename read from the served HTML) is an open decision recorded
  // in docs/architecture.md.
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
    // During development the SPA runs on the Vite dev server while the admin
    // API is served by the developer's NestJS application.
    proxy: {
      '/admin/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
