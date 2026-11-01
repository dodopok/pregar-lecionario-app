import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts', 'src/migrate.ts', 'src/admin.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // O domínio compartilhado é TypeScript do workspace e entra no pacote final.
  noExternal: ['@pregar/core'],
})
