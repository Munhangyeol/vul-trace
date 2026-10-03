import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/{api,cli,web}/src/**/*.test.ts'],
    environment: 'node',
  },
});
