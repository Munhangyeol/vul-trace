import { describe, expect, it } from 'vitest';
import { checkDevSupervisors } from './devSupervisor.js';

const aliveSet =
  (...pids: number[]) =>
  (pid: number) =>
    pids.includes(pid);

describe('checkDevSupervisors', () => {
  it('keeps running while watcher and launcher are alive', () => {
    expect(checkDevSupervisors({ watcherPid: 10, launcherPid: 20 }, aliveSet(10, 20))).toEqual({
      action: 'keep',
    });
  });

  it('keeps running without a launcher (plain `tsx watch src/dev.ts`)', () => {
    expect(checkDevSupervisors({ watcherPid: 10 }, aliveSet(10))).toEqual({ action: 'keep' });
  });

  it('exits when the watcher is gone', () => {
    expect(checkDevSupervisors({ watcherPid: 10, launcherPid: 20 }, aliveSet(20))).toMatchObject({
      action: 'exit',
    });
  });

  it('stops the orphaned watcher too when the launcher is gone', () => {
    expect(checkDevSupervisors({ watcherPid: 10, launcherPid: 20 }, aliveSet(10))).toMatchObject({
      action: 'stop-watcher-and-exit',
      reason: 'launcher process 20 exited',
    });
  });
});
