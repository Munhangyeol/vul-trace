import type { SpringEndpoint } from '@vulntrace/shared';

/** Phase 5: Spring endpoints discovered by a scan, stored with their annotation evidence. */
export interface EndpointRepository {
  saveEndpoints(scanId: string, endpoints: SpringEndpoint[]): Promise<void>;
  /** Ordered by path, HTTP method, then file and line. */
  listEndpoints(scanId: string): Promise<SpringEndpoint[]>;
}
