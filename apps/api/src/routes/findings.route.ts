import type { FastifyPluginAsync } from 'fastify';
import type { Container } from '../container.js';
import { toVulnerabilityFindingDto } from '../dto/vulnerability.dto.js';
import { replyNotImplemented } from './notImplemented.js';

export function createFindingRoutes(container: Container): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Params: { findingId: string } }>(
      '/findings/:findingId',
      async (request, reply) => {
        const stored = await container.findingRepository.findFindingById(request.params.findingId);
        if (!stored) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'finding not found' });
        }
        return toVulnerabilityFindingDto(stored);
      },
    );
    app.get('/findings/:findingId/usages', async (_req, reply) =>
      replyNotImplemented(reply, 'GET /findings/:findingId/usages'),
    );
    app.get('/findings/:findingId/reachability', async (_req, reply) =>
      replyNotImplemented(reply, 'GET /findings/:findingId/reachability'),
    );
  };
}
