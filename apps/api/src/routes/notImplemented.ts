import type { FastifyReply } from 'fastify';

export interface ErrorResponseDto {
  error: string;
  message: string;
}

export function replyNotImplemented(reply: FastifyReply, feature: string): FastifyReply {
  const body: ErrorResponseDto = { error: 'NOT_IMPLEMENTED', message: `${feature} is not implemented yet` };
  return reply.code(501).send(body);
}
