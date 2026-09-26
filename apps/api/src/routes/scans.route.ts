import type { FastifyPluginAsync } from 'fastify';
import { replyNotImplemented } from './notImplemented.js';

export const scanRoutes: FastifyPluginAsync = async (app) => {
  app.post('/projects/:projectId/scans', async (_req, reply) =>
    replyNotImplemented(reply, 'POST /projects/:projectId/scans'),
  );
  app.get('/projects/:projectId/scans', async (_req, reply) =>
    replyNotImplemented(reply, 'GET /projects/:projectId/scans'),
  );
};
