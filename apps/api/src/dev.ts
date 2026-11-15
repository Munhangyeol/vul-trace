/**
 * Development entry point, run by `tsx watch` (see scripts/dev.mjs, started by `pnpm dev:api`).
 *
 * - Prints a line immediately: loading Fastify, Prisma and the analysis packages takes several
 *   seconds (longer on a cold tsx cache), and without output the server looked hung.
 * - Stops when the processes that started it are gone. On Windows, killing the launcher or the
 *   pnpm chain does not stop `tsx watch` or this child, which then kept holding API_PORT and
 *   made the next start fail with EADDRINUSE.
 */
import { checkDevSupervisors } from './lib/devSupervisor.js';
import { EXIT_PORT_UNAVAILABLE } from './lib/listenWithRetry.js';
import { isProcessAlive } from './lib/processAlive.js';

const CHECK_INTERVAL_MS = 2000;
const startedAt = performance.now();
const watcherPid = process.ppid;
const launcherPid = Number(process.env.VULNTRACE_DEV_SUPERVISOR_PID) || undefined;

console.error(`[API] starting (dev, pid ${process.pid})…`);

setInterval(() => {
  const decision = checkDevSupervisors({ watcherPid, launcherPid }, isProcessAlive);
  if (decision.action === 'keep') return;
  console.error(`[API] ${decision.reason} — stopping dev server`);
  if (decision.action === 'stop-watcher-and-exit') {
    try {
      process.kill(watcherPid);
    } catch {
      // Already gone.
    }
  }
  process.exit(0);
}, CHECK_INTERVAL_MS).unref();

// A port problem will not go away by editing code, so stop the watcher too: `pnpm dev:api`
// then ends with an error instead of sitting silently. Code errors keep the watcher alive so
// saving a fix restarts the server as usual.
process.on('exit', (code) => {
  if (code !== EXIT_PORT_UNAVAILABLE) return;
  try {
    process.kill(watcherPid);
  } catch {
    // Already gone.
  }
});

await import('./main.js');

console.error(`[API] ready in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
