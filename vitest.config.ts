import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/{api,cli}/src/**/*.test.ts'],
    environment: 'node',
  },
});
