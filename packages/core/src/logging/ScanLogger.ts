export type ScanLogTag =
  | 'SCAN'
  | 'PROJECT'
  | 'DEPENDENCY'
  | 'SBOM'
  | 'VULN'
  | 'SOURCE'
  | 'SPRING'
  | 'REACHABILITY'
  | 'RISK';

/** Tagged scan log (CLAUDE.md §20). Never pass secrets or credentials. */
export interface ScanLogger {
  info(tag: ScanLogTag, message: string): void;
  error(tag: ScanLogTag, message: string): void;
}

export function createConsoleScanLogger(write: (line: string) => void = console.error): ScanLogger {
  return {
    info: (tag, message) => write(`[${tag}] ${message}`),
    error: (tag, message) => write(`[${tag}] ERROR ${message}`),
  };
}

export const silentScanLogger: ScanLogger = {
  info: () => undefined,
  error: () => undefined,
};
