import { describe, expect, it } from 'vitest';
import type { ScanStageResult } from '@vulntrace/shared';
import { deriveScanState } from './ScanOrchestrator.js';

const stage = (status: ScanStageResult['status']): ScanStageResult => ({
  stage: 'DEPENDENCY',
  status,
});

describe('deriveScanState', () => {
  it('is COMPLETED when nothing failed', () => {
    expect(deriveScanState([stage('SUCCEEDED'), stage('SKIPPED')])).toBe('COMPLETED');
  });

  it('is PARTIAL when a stage failed after another succeeded', () => {
    expect(deriveScanState([stage('SUCCEEDED'), stage('FAILED')])).toBe('PARTIAL');
  });

  it('is FAILED when no stage succeeded', () => {
    expect(deriveScanState([stage('FAILED'), stage('SKIPPED')])).toBe('FAILED');
  });
});
