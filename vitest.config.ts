import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
      exclude: [
        'apps/docs/src/**',
        'apps/api/src/main.ts',
        'apps/api/src/local-lab-main.ts',
        'apps/data-worker/src/main.ts',
        'apps/mcp/src/index.ts',
        'apps/mcp/src/http-main.ts',
        'apps/telemetry-ingress/src/main.ts',
        'apps/worker/src/main.ts',
        '**/*.d.ts',
        '**/*.{test,spec}.{ts,tsx}',
      ],
    },
    passWithNoTests: false,
    projects: [
      {
        test: {
          name: 'repository',
          include: ['packages/**/*.spec.ts', 'tests/**/*.spec.ts'],
          fileParallelism: false,
          passWithNoTests: false,
        },
      },
      'apps/*/vitest.config.ts',
    ],
  },
});
