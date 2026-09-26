import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'fixtures/**', '**/*.tsbuildinfo'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Dependency direction (CLAUDE.md §13): packages must never import apps.
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@vulntrace/api', '@vulntrace/cli', '@vulntrace/web'], message: 'packages/* must not depend on apps/*.' },
            { group: ['react', 'react-dom', 'fastify', '@prisma/client'], message: 'Analysis packages must stay framework-free.' },
          ],
        },
      ],
    },
  },
  {
    // web only talks to shared types.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@vulntrace/*', '!@vulntrace/shared'], message: 'apps/web may only depend on @vulntrace/shared.' },
          ],
        },
      ],
    },
  },
);
