import type { ScanJob } from '@vulntrace/shared';

export interface ScanRepository {
  save(scan: ScanJob): Promise<void>;
  findById(scanId: string): Promise<ScanJob | null>;
  listByProject(projectId: string): Promise<ScanJob[]>;
}
