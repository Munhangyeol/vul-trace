import type { ProjectEndpointsDto, SpringEndpoint, SpringEndpointDto } from '@vulntrace/shared';

export type { ProjectEndpointsDto, SpringEndpointDto };

export function toSpringEndpointDto(endpoint: SpringEndpoint): SpringEndpointDto {
  return {
    httpMethod: endpoint.httpMethod,
    path: endpoint.path,
    controllerClass: endpoint.controllerClass,
    controllerMethod: endpoint.controllerMethod,
    filePath: endpoint.location.filePath,
    line: endpoint.location.line,
    ...(endpoint.location.column !== undefined ? { column: endpoint.location.column } : {}),
    unresolved: endpoint.unresolved,
    evidence: endpoint.evidence,
  };
}
