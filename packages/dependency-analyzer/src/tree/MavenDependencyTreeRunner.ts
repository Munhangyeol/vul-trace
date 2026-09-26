import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platform } from 'node:process';
import type { AnalysisError, Result } from '@vulntrace/shared';
import { AnalysisError as AnalysisErrorClass, err, ok } from '@vulntrace/shared';
import type { ProcessRunner } from '../process/ProcessRunner.js';

/**
 * Pinned so a repository's own (possibly untrusted) plugin version is never used.
 * Confirm this is still current on Maven Central before relying on it in a Maven-enabled environment.
 */
const MAVEN_DEPENDENCY_PLUGIN_VERSION = '3.8.1';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const STDERR_TAIL_CHARS = 2000;

export interface MavenDependencyTreeRunOptions {
  timeoutMs?: number;
}

function mavenExecutable(): { command: string; useShell: boolean } {
  const override = process.env.VULNTRACE_MAVEN_PATH;
  if (override) {
    if (/[\s&|;<>^"']/.test(override)) {
      throw new AnalysisErrorClass(
        'EXTERNAL_PROCESS_FAILED',
        'VULNTRACE_MAVEN_PATH contains characters that are not allowed',
      );
    }
    return { command: override, useShell: platform === 'win32' };
  }
  // Node 20.12+ (CVE-2024-27980) requires shell:true to spawn a .cmd/.bat on Windows.
  return { command: platform === 'win32' ? 'mvn.cmd' : 'mvn', useShell: platform === 'win32' };
}

/** Runs `mvn dependency:tree` in a project root and returns the raw text output (CLAUDE.md §15). */
export class MavenDependencyTreeRunner {
  constructor(private readonly processRunner: ProcessRunner) {}

  async run(
    projectRoot: string,
    options: MavenDependencyTreeRunOptions = {},
  ): Promise<Result<string, AnalysisError>> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const tempDir = mkdtempSync(join(tmpdir(), 'vulntrace-'));
    const outputFile = join(tempDir, 'tree.txt');

    try {
      const { command, useShell } = mavenExecutable();
      const args = [
        '-B',
        '--no-transfer-progress',
        `org.apache.maven.plugins:maven-dependency-plugin:${MAVEN_DEPENDENCY_PLUGIN_VERSION}:tree`,
        '-DoutputType=text',
        `-DoutputFile=${outputFile}`,
      ];

      const result = await this.processRunner.run(command, args, {
        cwd: projectRoot,
        timeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        shell: useShell,
      });

      if (result.spawnError) {
        return err(
          new AnalysisErrorClass(
            'EXTERNAL_PROCESS_FAILED',
            `Failed to start Maven (${result.spawnError.message}). Is Maven installed and on PATH?`,
          ),
        );
      }

      if (result.timedOut) {
        return err(
          new AnalysisErrorClass(
            'EXTERNAL_PROCESS_FAILED',
            `mvn dependency:tree timed out after ${timeoutMs}ms`,
          ),
        );
      }

      if (result.exitCode !== 0) {
        const stderrTail = result.stderr.slice(-STDERR_TAIL_CHARS);
        return err(
          new AnalysisErrorClass(
            'EXTERNAL_PROCESS_FAILED',
            `mvn dependency:tree exited with code ${result.exitCode}: ${stderrTail}`,
          ),
        );
      }

      let treeText: string;
      try {
        treeText = readFileSync(outputFile, 'utf-8');
      } catch (cause) {
        return err(
          new AnalysisErrorClass(
            'EXTERNAL_PROCESS_FAILED',
            'mvn dependency:tree succeeded but produced no output file',
            { cause },
          ),
        );
      }

      return ok(treeText);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
