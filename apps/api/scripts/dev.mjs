#!/usr/bin/env node
/**
 * `pnpm dev:api` launcher: runs `tsx watch src/dev.ts` without handing it a piped stdin.
 *
 * `tsx watch` always reads stdin (Enter = restart), and the server child inherits the same
 * handle. On Windows, when stdin is an anonymous pipe (IDE task runners, preview tools, CI —
 * not an interactive terminal), the watcher's pending read blocks the child on that handle and
 * the server hangs during startup without printing anything. A terminal keeps its stdin, so
 * Enter-to-restart still works there.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');

const child = spawn(process.execPath, [tsxCli, 'watch', 'src/dev.ts', ...process.argv.slice(2)], {
  cwd: apiRoot,
  stdio: [process.stdin.isTTY ? 'inherit' : 'ignore', 'inherit', 'inherit'],
  // Lets the server stop itself (and the watcher) if this launcher is killed — see src/dev.ts.
  env: { ...process.env, VULNTRACE_DEV_SUPERVISOR_PID: String(process.pid) },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
