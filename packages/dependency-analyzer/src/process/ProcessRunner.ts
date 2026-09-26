import { spawn } from 'node:child_process';

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not even be spawned (e.g. ENOENT). */
  spawnError?: Error;
}

export interface ProcessRunOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  /** POSIX-only knob (CLAUDE.md §15 Windows note); ignored elsewhere. */
  shell?: boolean;
}

export interface ProcessRunner {
  run(command: string, args: readonly string[], options: ProcessRunOptions): Promise<ProcessResult>;
}

function truncate(chunks: Buffer[], maxBytes: number): string {
  let total = Buffer.concat(chunks);
  if (total.byteLength > maxBytes) total = total.subarray(0, maxBytes);
  return total.toString('utf-8');
}

/** Default `ProcessRunner`: `spawn` with a hard timeout and output cap (CLAUDE.md §15 — never shell-string-concat). */
export class NodeProcessRunner implements ProcessRunner {
  run(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions,
  ): Promise<ProcessResult> {
    return new Promise((resolvePromise) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;
      let settled = false;

      const child = spawn(command, args, {
        cwd: options.cwd,
        shell: options.shell ?? false,
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      child.on('error', (spawnError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          exitCode: null,
          stdout: truncate(stdoutChunks, options.maxOutputBytes),
          stderr: truncate(stderrChunks, options.maxOutputBytes),
          timedOut,
          spawnError,
        });
      });

      child.on('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          exitCode,
          stdout: truncate(stdoutChunks, options.maxOutputBytes),
          stderr: truncate(stderrChunks, options.maxOutputBytes),
          timedOut,
        });
      });
    });
  }
}
