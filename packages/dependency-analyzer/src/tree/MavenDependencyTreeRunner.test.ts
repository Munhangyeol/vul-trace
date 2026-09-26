import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProcessResult, ProcessRunner, ProcessRunOptions } from '../process/ProcessRunner.js';
import { MavenDependencyTreeRunner } from './MavenDependencyTreeRunner.js';

class FakeProcessRunner implements ProcessRunner {
  public lastCall?: { command: string; args: readonly string[]; options: ProcessRunOptions };

  constructor(
    private readonly handler: (
      options: ProcessRunOptions,
    ) => ProcessResult | Promise<ProcessResult>,
  ) {}

  async run(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions,
  ): Promise<ProcessResult> {
    this.lastCall = { command, args, options };
    return this.handler(options);
  }
}

const okResult = (): ProcessResult => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false });

function tempDirsUnderOsTmp(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('vulntrace-'));
}

describe('MavenDependencyTreeRunner', () => {
  const dirsBefore = new Set(tempDirsUnderOsTmp());

  afterEach(() => {
    for (const name of tempDirsUnderOsTmp()) {
      if (!dirsBefore.has(name)) rmSync(join(tmpdir(), name), { recursive: true, force: true });
    }
  });

  it('fails with EXTERNAL_PROCESS_FAILED when the executable is not found (ENOENT)', async () => {
    const runner = new FakeProcessRunner(() => ({
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: Object.assign(new Error('spawn mvn ENOENT'), { code: 'ENOENT' }),
    }));
    const result = await new MavenDependencyTreeRunner(runner).run('/some/project');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXTERNAL_PROCESS_FAILED');
      expect(result.error.message).toMatch(/ENOENT|Maven/i);
    }
  });

  it('fails with EXTERNAL_PROCESS_FAILED on timeout', async () => {
    const runner = new FakeProcessRunner(() => ({
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: true,
    }));
    const result = await new MavenDependencyTreeRunner(runner).run('/some/project', {
      timeoutMs: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/timed out/);
  });

  it('fails with EXTERNAL_PROCESS_FAILED on a non-zero exit code', async () => {
    const runner = new FakeProcessRunner(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'BUILD FAILURE: dependency resolution failed',
      timedOut: false,
    }));
    const result = await new MavenDependencyTreeRunner(runner).run('/some/project');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('BUILD FAILURE');
  });

  it('fails when the process succeeds but the output file is missing', async () => {
    const runner = new FakeProcessRunner(() => okResult());
    const result = await new MavenDependencyTreeRunner(runner).run('/some/project');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/no output file/);
  });

  it('cleans up its temp directory on success', async () => {
    const writingRunner: ProcessRunner = {
      run: async (_command, args) => {
        const outputArg = args.find((a) => a.startsWith('-DoutputFile='));
        const outputFile = outputArg?.slice('-DoutputFile='.length);
        if (outputFile) writeFileSync(outputFile, 'com.example:demo:jar:1.0.0\n');
        return okResult();
      },
    };

    const result = await new MavenDependencyTreeRunner(writingRunner).run('/some/project');
    expect(result.ok).toBe(true);
    expect(tempDirsUnderOsTmp().filter((name) => !dirsBefore.has(name))).toEqual([]);
  });

  it('cleans up its temp directory on failure', async () => {
    const runner = new FakeProcessRunner(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'boom',
      timedOut: false,
    }));
    await new MavenDependencyTreeRunner(runner).run('/some/project');
    expect(tempDirsUnderOsTmp().filter((name) => !dirsBefore.has(name))).toEqual([]);
  });

  it('passes fixed, non-shell-interpolated arguments', async () => {
    const runner = new FakeProcessRunner(() => okResult());
    await new MavenDependencyTreeRunner(runner).run('/some/project');
    const args = runner.lastCall?.args ?? [];
    expect(args).toContain('-DoutputType=text');
    expect(
      args.some((a) => a.startsWith('org.apache.maven.plugins:maven-dependency-plugin:')),
    ).toBe(true);
    expect(args.some((a) => /[;&|`$]/.test(a))).toBe(false);
  });
});
