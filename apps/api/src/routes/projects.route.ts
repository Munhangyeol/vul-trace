import type { FastifyPluginAsync } from 'fastify';
import { replyNotImplemented } from './notImplemented.js';

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.post('/projects', async (_req, reply) => replyNotImplemented(reply, 'POST /projects'));
  app.get('/projects', async (_req, reply) => replyNotImplemented(reply, 'GET /projects'));
  app.get('/projects/:projectId', async (_req, reply) =>
    replyNotImplemented(reply, 'GET /projects/:projectId'),
  );
  app.get('/projects/:projectId/dependencies', async (_req, reply) =>
    replyNotImplemented(reply, 'GET /projects/:projectId/dependencies'),
  );
  app.get('/projects/:projectId/vulnerabilities', async (_req, reply) =>
    replyNotImplemented(reply, 'GET /projects/:projectId/vulnerabilities'),
  );
};
