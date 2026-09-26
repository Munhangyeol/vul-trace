import { afterAll, describe, expect, it } from 'vitest';
import { silentScanLogger, createScanOrchestrator } from '@vulntrace/core';
import { buildServer } from './server.js';

const app = buildServer({ scanOrchestrator: createScanOrchestrator({ logger: silentScanLogger }) });

afterAll(async () => {
  await app.close();
});

describe('api server', () => {
  it('GET /api/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('unimplemented routes return 501', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ error: 'NOT_IMPLEMENTED' });
  });
});
