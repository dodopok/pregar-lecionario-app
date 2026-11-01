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
  // Bundle autossuficiente: a imagem final não precisa de node_modules.
  noExternal: [/.*/],
  external: ['pg-native'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
})
