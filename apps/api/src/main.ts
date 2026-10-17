import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { buildServer } from './server.js';

// Repository-root .env (shared with Prisma and the web dev proxy). Variables already set in the
// shell take precedence, so `API_PORT=4000 pnpm dev:api` still overrides it.
const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const config = loadConfig();
const app = buildServer(createContainer({ scanRoot: config.scanRoot }), { logger: true });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
