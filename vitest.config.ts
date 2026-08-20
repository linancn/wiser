import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    include: ['packages/**/*.spec.ts', 'tests/**/*.spec.ts'],
    passWithNoTests: true,
  },
});
