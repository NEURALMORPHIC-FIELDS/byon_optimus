import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['shared/**/*.ts', 'cli/**/*.ts'],
      exclude: ['**/*.test.ts', '**/node_modules/**'],
    },
    testTimeout: 10000,
  },
});
