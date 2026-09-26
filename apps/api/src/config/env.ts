export interface ApiConfig {
  host: string;
  port: number;
  /** When set, project paths must resolve inside this directory (CLAUDE.md §4.2). */
  scanRoot?: string;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`API_PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: env.API_HOST || '127.0.0.1',
    port: parsePort(env.API_PORT, 3000),
    scanRoot: env.VULNTRACE_SCAN_ROOT || undefined,
  };
}
