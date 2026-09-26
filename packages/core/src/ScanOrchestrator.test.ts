import { describe, expect, it } from 'vitest';
import { AnalysisError, err, ok } from '@vulntrace/shared';
import type { ProjectDependency, ScanStageResult, VulnerabilityFinding } from '@vulntrace/shared';
import type { DependencyAnalysisResult, DependencyAnalyzer } from '@vulntrace/dependency-analyzer';
import type { CycloneDxBom, SbomBuilder, SbomBuildResult } from '@vulntrace/sbom';
import type { BatchVulnerabilityResult, VulnerabilityProvider } from '@vulntrace/vulnerability';
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

/** Never invoked when `dependencies` is empty — only used by tests that need it. */
const unusedSbomBuilder: SbomBuilder = {
  build: () => {
    throw new Error('sbomBuilder should not be called');
  },
};
const unusedVulnerabilityProvider: VulnerabilityProvider = {
  findByPackage: () => {
    throw new Error('vulnerabilityProvider should not be called');
  },
  findByPackages: () => {
    throw new Error('vulnerabilityProvider should not be called');
  },
};

function fakeSbomBuilder(build: () => ReturnType<SbomBuilder['build']>): SbomBuilder {
  return { build };
}
function fakeVulnerabilityProvider(
  findByPackages: VulnerabilityProvider['findByPackages'],
): VulnerabilityProvider {
  return {
    findByPackage: async () => {
      throw new Error('not used in these tests');
    },
    findByPackages,
  };
}

const dep = (purl: string): ProjectDependency => ({
  coordinate: {
    groupId: 'org.apache.commons',
    artifactId: 'commons-text',
    version: '1.9',
    scope: 'compile',
    direct: true,
    purl,
  },
  source: { kind: 'pom.xml', filePath: 'pom.xml' },
});

function bom(components: CycloneDxBom['components']): SbomBuildResult {
  return {
    bom: {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      serialNumber: 'urn:uuid:00000000-0000-4000-8000-000000000000',
      version: 1,
      metadata: {
        timestamp: '2026-01-01T00:00:00.000Z',
        tools: [],
        component: { type: 'application', name: 'demo', version: '1.0.0' },
      },
      components,
      dependencies: [],
    },
    warnings: [],
  };
}

describe('ScanOrchestrator.run', () => {
  it('maps a successful analysis to PROJECT_DETECTION/DEPENDENCY SUCCEEDED and DEPENDENCY_TREE SKIPPED', async () => {
    const orchestrator = new ScanOrchestrator({
      dependencyAnalyzer: fakeAnalyzer(async () => ok(analysisResult())),
      sbomBuilder: unusedSbomBuilder,
      vulnerabilityProvider: unusedVulnerabilityProvider,
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
      sbomBuilder: unusedSbomBuilder,
      vulnerabilityProvider: unusedVulnerabilityProvider,
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
      sbomBuilder: unusedSbomBuilder,
      vulnerabilityProvider: unusedVulnerabilityProvider,
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
      sbomBuilder: unusedSbomBuilder,
      vulnerabilityProvider: unusedVulnerabilityProvider,
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
      sbomBuilder: unusedSbomBuilder,
      vulnerabilityProvider: unusedVulnerabilityProvider,
      logger: silentScanLogger,
    });
    const report = await orchestrator.run('/project');

    expect(report.state).toBe('FAILED');
    expect(report.stages[0]).toMatchObject({ stage: 'DEPENDENCY', status: 'FAILED' });
  });

  describe('SBOM / VULNERABILITY stage transitions (Phase 2 plan §1)', () => {
    it('skips both SBOM and VULNERABILITY when the dependency stage itself failed', async () => {
      const orchestrator = new ScanOrchestrator({
        dependencyAnalyzer: fakeAnalyzer(async () =>
          err(new AnalysisError('PARSE_ERROR', 'bad pom')),
        ),
        sbomBuilder: unusedSbomBuilder,
        vulnerabilityProvider: unusedVulnerabilityProvider,
        logger: silentScanLogger,
      });
      const report = await orchestrator.run('/project');

      expect(report.stages).toContainEqual({
        stage: 'SBOM',
        status: 'SKIPPED',
        reason: 'no dependency analysis result',
      });
      expect(report.stages).toContainEqual({
        stage: 'VULNERABILITY',
        status: 'SKIPPED',
        reason: 'no dependency analysis result',
      });
    });

    it('with 0 resolved dependencies: SBOM SUCCEEDED (0 components), VULNERABILITY SKIPPED', async () => {
      const orchestrator = new ScanOrchestrator({
        dependencyAnalyzer: fakeAnalyzer(async () => ok(analysisResult({ dependencies: [] }))),
        sbomBuilder: unusedSbomBuilder,
        vulnerabilityProvider: unusedVulnerabilityProvider,
        logger: silentScanLogger,
      });
      const report = await orchestrator.run('/project');

      expect(report.state).toBe('COMPLETED');
      expect(report.stages).toContainEqual({ stage: 'SBOM', status: 'SUCCEEDED' });
      expect(report.stages).toContainEqual({
        stage: 'VULNERABILITY',
        status: 'SKIPPED',
        reason: 'no resolved dependencies to check',
      });
      expect(report.vulnerabilityCoverage).toEqual({ checked: 0, notChecked: 0, failed: 0 });
    });

    it('skips VULNERABILITY when checkVulnerabilities is false, keeping SBOM', async () => {
      const dependencies = [dep('pkg:maven/org.apache.commons/commons-text@1.9')];
      const orchestrator = new ScanOrchestrator({
        dependencyAnalyzer: fakeAnalyzer(async () => ok(analysisResult({ dependencies }))),
        sbomBuilder: fakeSbomBuilder(() => ok(bom([{ type: 'library', purl: dependencies[0]!.coordinate.purl, group: 'org.apache.commons', name: 'commons-text', version: '1.9', scope: 'required' }]))),
        vulnerabilityProvider: unusedVulnerabilityProvider,
        logger: silentScanLogger,
      });
      const report = await orchestrator.run('/project', { allowMaven: false, checkVulnerabilities: false });

      expect(report.state).toBe('COMPLETED');
      expect(report.stages).toContainEqual({ stage: 'SBOM', status: 'SUCCEEDED' });
      expect(report.stages).toContainEqual({
        stage: 'VULNERABILITY',
        status: 'SKIPPED',
        reason: 'vulnerability check disabled',
      });
    });

    it('SBOM build failure marks SBOM FAILED, VULNERABILITY SKIPPED, overall PARTIAL', async () => {
      const dependencies = [dep('pkg:maven/org.apache.commons/commons-text@1.9')];
      const orchestrator = new ScanOrchestrator({
        dependencyAnalyzer: fakeAnalyzer(async () => ok(analysisResult({ dependencies }))),
        sbomBuilder: fakeSbomBuilder(() => err(new AnalysisError('PARSE_ERROR', 'bad timestamp'))),
        vulnerabilityProvider: unusedVulnerabilityProvider,
        logger: silentScanLogger,
      });
      const report = await orchestrator.run('/project');

      expect(report.state).toBe('PARTIAL');
      expect(report.stages).toContainEqual({
        stage: 'SBOM',
        status: 'FAILED',
        reason: 'PARSE_ERROR: bad timestamp',
      });
      expect(report.stages).toContainEqual({
        stage: 'VULNERABILITY',
        status: 'SKIPPED',
        reason: 'SBOM not available',
      });
    });

    it('a full OSV failure marks VULNERABILITY FAILED, overall PARTIAL, SBOM preserved', async () => {
      const dependencies = [dep('pkg:maven/org.apache.commons/commons-text@1.9')];
      const orchestrator = new ScanOrchestrator({
        dependencyAnalyzer: fakeAnalyzer(async () => ok(analysisResult({ dependencies }))),
        sbomBuilder: fakeSbomBuilder(() =>
          ok(bom([{ type: 'library', purl: dependencies[0]!.coordinate.purl, group: 'org.apache.commons', name: 'commons-text', version: '1.9', scope: 'required' }])),
        ),
        vulnerabilityProvider: fakeVulnerabilityProvider(async () =>
          err(new AnalysisError('EXTERNAL_SERVICE_FAILED', 'OSV unreachable')),
        ),
        logger: silentScanLogger,
      });
      const report = await orchestrator.run('/project');

      expect(report.state).toBe('PARTIAL');
      expect(report.stages).toContainEqual({ stage: 'SBOM', status: 'SUCCEEDED' });
      expect(report.stages).toContainEqual({
        stage: 'VULNERABILITY',
        status: 'FAILED',
        reason: 'EXTERNAL_SERVICE_FAILED: OSV unreachable',
      });
      expect(report.sbom).toBeDefined();
    });

    it('partial package failures mark VULNERABILITY FAILED but keep the findings that succeeded', async () => {
      const dependencies = [dep('pkg:maven/org.apache.commons/commons-text@1.9')];
      const finding: VulnerabilityFinding = {
        vulnerability: {
          id: 'GHSA-599f-7c49-w659',
          aliases: ['CVE-2022-42889'],
          summary: 'x',
          severity: 'CRITICAL',
          severitySource: 'CVSS_V3',
          modified: '2024-01-01T00:00:00Z',
          references: [],
        },
        package: { ecosystem: 'Maven', name: 'org.apache.commons:commons-text', version: '1.9', purl: dependencies[0]!.coordinate.purl },
        fixedVersions: ['1.10.0'],
        evidence: { provider: 'OSV', queriedAt: '2026-01-01T00:00:00Z', affectedRanges: [], affectedVersions: [] },
      };
      const batchResult: BatchVulnerabilityResult = {
        findings: [finding],
        failedPackages: [{ purl: 'pkg:maven/other/other@1.0', reason: 'timeout' }],
        warnings: [],
      };
      const orchestrator = new ScanOrchestrator({
        dependencyAnalyzer: fakeAnalyzer(async () => ok(analysisResult({ dependencies }))),
        sbomBuilder: fakeSbomBuilder(() =>
          ok(bom([{ type: 'library', purl: dependencies[0]!.coordinate.purl, group: 'org.apache.commons', name: 'commons-text', version: '1.9', scope: 'required' }])),
        ),
        vulnerabilityProvider: fakeVulnerabilityProvider(async () => ok(batchResult)),
        logger: silentScanLogger,
      });
      const report = await orchestrator.run('/project');

      expect(report.state).toBe('PARTIAL');
      expect(report.findings).toEqual([finding]);
      expect(report.vulnerabilityCoverage).toEqual({ checked: 1, notChecked: 0, failed: 1 });
      expect(report.stages).toContainEqual({
        stage: 'VULNERABILITY',
        status: 'FAILED',
        reason: '1 of 1 packages failed',
      });
    });

    it('a full success yields SBOM and VULNERABILITY SUCCEEDED, overall COMPLETED, with findings', async () => {
      const dependencies = [dep('pkg:maven/org.apache.commons/commons-text@1.9')];
      const finding: VulnerabilityFinding = {
        vulnerability: {
          id: 'GHSA-599f-7c49-w659',
          aliases: ['CVE-2022-42889'],
          summary: 'x',
          severity: 'CRITICAL',
          severitySource: 'CVSS_V3',
          modified: '2024-01-01T00:00:00Z',
          references: [],
        },
        package: { ecosystem: 'Maven', name: 'org.apache.commons:commons-text', version: '1.9', purl: dependencies[0]!.coordinate.purl },
        fixedVersions: ['1.10.0'],
        evidence: { provider: 'OSV', queriedAt: '2026-01-01T00:00:00Z', affectedRanges: [], affectedVersions: [] },
      };
      const orchestrator = new ScanOrchestrator({
        dependencyAnalyzer: fakeAnalyzer(async () => ok(analysisResult({ dependencies }))),
        sbomBuilder: fakeSbomBuilder(() =>
          ok(bom([{ type: 'library', purl: dependencies[0]!.coordinate.purl, group: 'org.apache.commons', name: 'commons-text', version: '1.9', scope: 'required' }])),
        ),
        vulnerabilityProvider: fakeVulnerabilityProvider(async () =>
          ok({ findings: [finding], failedPackages: [], warnings: [] }),
        ),
        logger: silentScanLogger,
      });
      const report = await orchestrator.run('/project');

      expect(report.state).toBe('COMPLETED');
      expect(report.stages).toContainEqual({ stage: 'SBOM', status: 'SUCCEEDED' });
      expect(report.stages).toContainEqual({ stage: 'VULNERABILITY', status: 'SUCCEEDED' });
      expect(report.findings).toEqual([finding]);
      expect(report.vulnerabilityCoverage).toEqual({ checked: 1, notChecked: 0, failed: 0 });
    });
  });
});
