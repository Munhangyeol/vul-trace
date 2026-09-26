import type { FastifyPluginAsync } from 'fastify';
import { replyNotImplemented } from './notImplemented.js';

export const findingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/findings/:findingId', async (_req, reply) =>
    replyNotImplemented(reply, 'GET /findings/:findingId'),
  );
  app.get('/findings/:findingId/usages', async (_req, reply) =>
    replyNotImplemented(reply, 'GET /findings/:findingId/usages'),
  );
  app.get('/findings/:findingId/reachability', async (_req, reply) =>
    replyNotImplemented(reply, 'GET /findings/:findingId/reachability'),
  );
};
