import type { FastifyPluginAsync } from 'fastify';

export interface HealthResponseDto {
  status: 'ok';
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (): Promise<HealthResponseDto> => ({ status: 'ok' }));
};
