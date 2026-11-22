import type { DependencyRemediation, DependencyRemediationDto } from '@vulntrace/shared';
import { pickDisplayId } from '@vulntrace/core';

export function toDependencyRemediationDto(plan: DependencyRemediation): DependencyRemediationDto {
  return {
    ...plan,
    findings: plan.findings.map((f) => ({
      ...f,
      displayId: pickDisplayId({ id: f.vulnerabilityId, aliases: f.aliases } as Parameters<typeof pickDisplayId>[0]),
    })),
  };
}
