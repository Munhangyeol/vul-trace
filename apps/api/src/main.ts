import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { buildServer } from './server.js';

const config = loadConfig();
const app = buildServer(createContainer(), { logger: true });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
