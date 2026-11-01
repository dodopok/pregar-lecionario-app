import { defineProject } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineProject({
  plugins: [vue()],
  test: {
    name: 'desktop',
    root: './apps/desktop',
    include: ['test/unit/**/*.test.ts'],
    environment: 'happy-dom',
  },
})
