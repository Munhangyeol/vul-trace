import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Container } from './container.js';
import { findingRoutes } from './routes/findings.route.js';
import { healthRoutes } from './routes/health.route.js';
import { projectRoutes } from './routes/projects.route.js';
import { scanRoutes } from './routes/scans.route.js';

export function buildServer(_container: Container, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(projectRoutes);
      await api.register(scanRoutes);
      await api.register(findingRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
