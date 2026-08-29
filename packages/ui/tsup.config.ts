import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  // ESM only: the sole consumer is the Vite-built admin UI.
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
})
