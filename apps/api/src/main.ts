import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { EXIT_PORT_UNAVAILABLE, isPortError, listenWithRetry } from './lib/listenWithRetry.js';
import { buildServer } from './server.js';

// Repository-root .env (shared with Prisma and the web dev proxy). Variables already set in the
// shell take precedence, so `API_PORT=4000 pnpm dev:api` still overrides it.
const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const LISTEN_ATTEMPTS = 10;
const LISTEN_RETRY_DELAY_MS = 500;

const config = loadConfig();
const app = buildServer(createContainer({ scanRoot: config.scanRoot }), { logger: true });
const address = `${config.host}:${config.port}`;

try {
  await listenWithRetry(() => app.listen({ host: config.host, port: config.port }), {
    attempts: LISTEN_ATTEMPTS,
    delayMs: LISTEN_RETRY_DELAY_MS,
    onRetry: (error, attempt) =>
      console.error(
        `[API] listen on ${address} failed (${(error as NodeJS.ErrnoException).code}), retrying ${attempt}/${LISTEN_ATTEMPTS - 1}…`,
      ),
  });
} catch (error) {
  app.log.error(error);
  if (isPortError(error)) {
    console.error(
      `[API] could not listen on ${address} after ${LISTEN_ATTEMPTS} attempts. Usually an earlier ` +
        `VulnTrace API is still running: find it with ` +
        `Get-NetTCPConnection -LocalPort ${config.port} -State Listen (PowerShell), or set API_PORT in .env.`,
    );
    process.exit(EXIT_PORT_UNAVAILABLE);
  }
  process.exit(1);
}
