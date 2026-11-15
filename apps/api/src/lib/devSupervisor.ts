export type DevSupervisorDecision =
  | { action: 'keep' }
  | { action: 'exit'; reason: string }
  | { action: 'stop-watcher-and-exit'; reason: string };

/**
 * Decides whether the dev server should keep running. `watcherPid` is the `tsx watch` process
 * (this process's parent); `launcherPid` is scripts/dev.mjs, when started through it. If the
 * launcher is gone the watcher is orphaned too, and would restart the server on the next file
 * change, so it is stopped as well.
 */
export function checkDevSupervisors(
  pids: { watcherPid: number; launcherPid?: number },
  isAlive: (pid: number) => boolean,
): DevSupervisorDecision {
  if (!isAlive(pids.watcherPid)) {
    return { action: 'exit', reason: `watcher process ${pids.watcherPid} exited` };
  }
  if (pids.launcherPid !== undefined && !isAlive(pids.launcherPid)) {
    return {
      action: 'stop-watcher-and-exit',
      reason: `launcher process ${pids.launcherPid} exited`,
    };
  }
  return { action: 'keep' };
}
