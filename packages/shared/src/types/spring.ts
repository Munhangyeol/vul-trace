import type { SourceLocation } from './source-usage.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface SpringEndpoint {
  httpMethod: HttpMethod;
  path: string;
  controllerClass: string;
  controllerMethod: string;
  location: SourceLocation;
}
