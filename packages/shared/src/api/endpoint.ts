import type { ScanStageResult } from '../types/project.js';
import type { EndpointHttpMethod, SpringEndpointEvidence } from '../types/spring.js';

export interface SpringEndpointDto {
  httpMethod: EndpointHttpMethod;
  path: string;
  controllerClass: string;
  controllerMethod: string;
  /** Handler method declaration. */
  filePath: string;
  line: number;
  column?: number;
  /** Annotation expressions that could not be evaluated statically; empty = fully resolved. */
  unresolved: string[];
  evidence: SpringEndpointEvidence;
}

/** GET /api/projects/:projectId/endpoints — from the latest scan. */
export interface ProjectEndpointsDto {
  /** null when the project has never been scanned. */
  scanId: string | null;
  /** True only when the latest scan's SPRING_ENDPOINT stage succeeded; otherwise see `stage`. */
  analyzed: boolean;
  stage?: ScanStageResult;
  endpoints: SpringEndpointDto[];
}
