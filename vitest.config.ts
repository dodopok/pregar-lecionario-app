import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/core',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'editor',
          root: './packages/editor',
          include: ['test/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
      {
        test: {
          name: 'api',
          root: './apps/api',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
      './apps/desktop/vitest.config.ts',
    ],
  },
})
