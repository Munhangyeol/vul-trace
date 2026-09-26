import type { ScanOrchestrator } from '@vulntrace/core';
import { createConsoleScanLogger, createScanOrchestrator } from '@vulntrace/core';

/** Manual DI: everything the routes need, assembled once at startup. */
export interface Container {
  scanOrchestrator: ScanOrchestrator;
}

export function createContainer(): Container {
  return {
    scanOrchestrator: createScanOrchestrator({ logger: createConsoleScanLogger() }),
  };
}
