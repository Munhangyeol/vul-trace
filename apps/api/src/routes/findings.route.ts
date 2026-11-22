import type { FastifyPluginAsync } from 'fastify';
import type { Container } from '../container.js';
import { toFindingUsagesDto } from '../dto/usage.dto.js';
import { toVulnerabilityFindingDto } from '../dto/vulnerability.dto.js';
import { planRemediation } from '@vulntrace/core';
import type { FindingRemediationDto } from '@vulntrace/shared';
import { toFindingReachabilityDto } from '../dto/reachability.dto.js';
import { toDependencyRemediationDto } from '../dto/remediation.dto.js';

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
    app.get<{ Params: { findingId: string } }>(
      '/findings/:findingId/usages',
      async (request, reply) => {
        const stored = await container.findingRepository.findFindingById(request.params.findingId);
        if (!stored) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'finding not found' });
        }
        return toFindingUsagesDto(stored);
      },
    );
    app.get<{ Params: { findingId: string } }>(
      '/findings/:findingId/reachability',
      async (request, reply) => {
        const stored = await container.findingRepository.findFindingById(request.params.findingId);
        if (!stored) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'finding not found' });
        }
        return toFindingReachabilityDto(stored);
      },
    );
    app.get<{ Params: { findingId: string } }>(
      '/findings/:findingId/remediation',
      async (request, reply) => {
        const stored = await container.findingRepository.findFindingById(request.params.findingId);
        if (!stored) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'finding not found' });
        }
        // Plan across every finding of the same dependency in the same scan (Phase 8 D1).
        const [siblings, dependencies] = await Promise.all([
          container.findingRepository.listFindings(stored.scanId),
          container.findingRepository.listDependencies(stored.scanId),
        ]);
        const purl = stored.finding.package.purl;
        const [plan] = planRemediation({
          findings: siblings.filter((s) => s.finding.package.purl === purl).map((s) => ({ id: s.id, finding: s.finding })),
          dependencies,
        });
        if (!plan) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'no remediation for this finding' });
        }
        const dto: FindingRemediationDto = {
          findingId: stored.id,
          status: plan.findings.find((f) => f.findingId === stored.id)?.status ?? 'UNKNOWN',
          remediation: toDependencyRemediationDto(plan),
        };
        return dto;
      },
    );
  };
}
