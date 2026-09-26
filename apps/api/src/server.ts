import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Container } from './container.js';
import { createFindingRoutes } from './routes/findings.route.js';
import { healthRoutes } from './routes/health.route.js';
import { createProjectRoutes } from './routes/projects.route.js';
import { createScanRoutes } from './routes/scans.route.js';

export function buildServer(
  container: Container,
  options: { logger?: boolean } = {},
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(createProjectRoutes(container));
      await api.register(createScanRoutes(container));
      await api.register(createFindingRoutes(container));
    },
    { prefix: '/api' },
  );

  return app;
}
