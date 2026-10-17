import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Same API_PORT resolution as the API server: shell first, then the repository-root .env, then 3000.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const apiPort = process.env.API_PORT ?? loadEnv(mode, repoRoot, '').API_PORT ?? '3000';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`,
      },
    },
  };
});
