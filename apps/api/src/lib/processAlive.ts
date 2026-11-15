/**
 * True while a process with this pid exists. Signal 0 checks existence without sending
 * anything; EPERM means it exists but belongs to someone else.
 */
export function isProcessAlive(pid: number, kill: typeof process.kill = process.kill): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
