import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'

// O app empacota tudo no build (inclusive o domínio do workspace): o instalador não leva node_modules.
const bundleEverything = { externalizeDeps: false } as const

/** CSP da janela do app. Em desenvolvimento libera o servidor do Vite e o HMR. */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'pregar-csp',
    transformIndexHtml(html, context) {
      const dev = Boolean(context.server)
      const policy = [
        "default-src 'self'",
        dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        `connect-src 'self' pregar-pdf: pregar-asset: blob: data:${dev ? ' ws: http://localhost:*' : ''}`,
        "worker-src 'self' blob:",
        "media-src 'self' blob:",
        "object-src 'none'",
        "frame-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ')
      return html.replace('%CSP%', policy)
    },
  }
}

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      ...bundleEverything,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          indexer: resolve(__dirname, 'src/main/workers/indexer.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      ...bundleEverything,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        ...alias,
        '@': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [vue(), contentSecurityPolicy()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
      chunkSizeWarningLimit: 2500,
    },
    worker: { format: 'es' },
  },
})
