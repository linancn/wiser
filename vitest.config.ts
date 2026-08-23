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
      thresholds: {
        statements: 73,
        branches: 67,
        functions: 75,
        lines: 76,
        'packages/core/src/v2/**/*.ts': {
          statements: 88,
          branches: 80,
          functions: 88,
          lines: 88,
        },
        'packages/core/src/v2/shared.ts': {
          statements: 100,
          branches: 95,
          functions: 100,
          lines: 100,
        },
        'apps/telemetry-ingress/src/forwarder.ts': {
          statements: 100,
          branches: 92,
          functions: 100,
          lines: 100,
        },
        'packages/data-infra/src/projections/graph-stac/validation.ts': {
          statements: 88,
          branches: 87,
          functions: 100,
          lines: 89,
        },
        'packages/data-infra/src/projections/postgis/validation.ts': {
          statements: 86,
          branches: 84,
          functions: 100,
          lines: 87,
        },
      },
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
