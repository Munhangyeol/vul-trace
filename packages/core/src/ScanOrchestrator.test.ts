import { describe, expect, it } from 'vitest';
import { AnalysisError, err, ok } from '@vulntrace/shared';
import type { ScanStageResult } from '@vulntrace/shared';
import type { DependencyAnalysisResult, DependencyAnalyzer } from '@vulntrace/dependency-analyzer';
import { deriveScanState, ScanOrchestrator } from './ScanOrchestrator.js';
import { silentScanLogger } from './logging/ScanLogger.js';

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

const analysisResult = (
  overrides: Partial<DependencyAnalysisResult> = {},
): DependencyAnalysisResult => ({
  project: { groupId: 'com.example', artifactId: 'demo', version: '1.0.0', pomPath: 'pom.xml' },
  dependencies: [],
  unresolvedDependencies: [],
  transitive: { status: 'SKIPPED', reason: 'maven execution not allowed' },
  warnings: [],
  ...overrides,
});

function fakeAnalyzer(analyze: DependencyAnalyzer['analyze']): DependencyAnalyzer {
  return { analyze };
}

describe('ScanOrchestrator.run', () => {
  it('maps a successful analysis to PROJECT_DETECTION/DEPENDENCY SUCCEEDED and DEPENDENCY_TREE SKIPPED', async () => {
    const orchestrator = new ScanOrchestrator({
      dependencyAnalyzer: fakeAnalyzer(async () => ok(analysisResult())),
      logger: silentScanLogger,
    });
    const report = await orchestrator.run('/project');

    expect(report.state).toBe('COMPLETED');
    expect(report.project).toEqual(analysisResult().project);
    expect(report.stages).toEqual(
      expect.arrayContaining([
        { stage: 'PROJECT_DETECTION', status: 'SUCCEEDED' },
        { stage: 'DEPENDENCY', status: 'SUCCEEDED' },
        {
          stage: 'DEPENDENCY_TREE',
          status: 'SKIPPED',
          reason: 'maven execution not allowed',
        },
      ]),
    );
  });

  it('maps a RESOLVED transitive result to DEPENDENCY_TREE SUCCEEDED', async () => {
    const orchestrator = new ScanOrchestrator({
      dependencyAnalyzer: fakeAnalyzer(async () =>
        ok(analysisResult({ transitive: { status: 'RESOLVED' } })),
      ),
      logger: silentScanLogger,
    });
    const report = await orchestrator.run('/project');

    expect(report.state).toBe('COMPLETED');
    expect(report.stages).toContainEqual({ stage: 'DEPENDENCY_TREE', status: 'SUCCEEDED' });
  });

  it('is PARTIAL and preserves dependencies when the tree run fails', async () => {
    const orchestrator = new ScanOrchestrator({
      dependencyAnalyzer: fakeAnalyzer(async () =>
        ok(
          analysisResult({
            transitive: { status: 'FAILED', reason: 'mvn exited with code 1' },
          }),
        ),
      ),
      logger: silentScanLogger,
    });
    const report = await orchestrator.run('/project');

    expect(report.state).toBe('PARTIAL');
    expect(report.stages).toContainEqual({
      stage: 'DEPENDENCY_TREE',
      status: 'FAILED',
      reason: 'mvn exited with code 1',
    });
  });

  it('maps PROJECT_NOT_FOUND to a FAILED PROJECT_DETECTION stage and overall FAILED state', async () => {
    const orchestrator = new ScanOrchestrator({
      dependencyAnalyzer: fakeAnalyzer(async () =>
        err(new AnalysisError('PROJECT_NOT_FOUND', 'Project path not found: /missing')),
      ),
      logger: silentScanLogger,
    });
    const report = await orchestrator.run('/missing');

    expect(report.state).toBe('FAILED');
    expect(report.stages[0]).toMatchObject({ stage: 'PROJECT_DETECTION', status: 'FAILED' });
    expect(report.dependencies).toEqual([]);
  });

  it('maps a PARSE_ERROR to a FAILED DEPENDENCY stage', async () => {
    const orchestrator = new ScanOrchestrator({
      dependencyAnalyzer: fakeAnalyzer(async () =>
        err(new AnalysisError('PARSE_ERROR', 'pom.xml missing <artifactId>: pom.xml')),
      ),
      logger: silentScanLogger,
    });
    const report = await orchestrator.run('/project');

    expect(report.state).toBe('FAILED');
    expect(report.stages[0]).toMatchObject({ stage: 'DEPENDENCY', status: 'FAILED' });
  });
});
