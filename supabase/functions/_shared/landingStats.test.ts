import { describe, it, expect, vi } from 'vitest';
import { createLandingStatsHandler } from './landingStats';
const request = (method = 'GET') => new Request('https://example.invalid/stats', { method });
const stats = { completed_trips: 60, avg_rating: 4.7 };
describe('public aggregate protection', () => {
  it('coalesces concurrent requests and refreshes only after TTL', async () => {
    let time = 0;
    const load = vi.fn(async () => stats);
    const handler = createLandingStatsHandler(load, () => time);
    const responses = await Promise.all(Array.from({ length: 100 }, () => handler(request())));
    expect(load).toHaveBeenCalledTimes(1);
    expect(await responses[0].json()).toEqual(stats);
    expect(responses.every(r => r.status === 200)).toBe(true);
    time = 60_001;
    await handler(request());
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('bounds warm-worker traffic and resets the window', async () => {
    let time = 0;
    const load = vi.fn(async () => stats);
    const handler = createLandingStatsHandler(load, () => time);
    for (let i = 0; i < 300; i++) expect((await handler(request())).status).toBe(200);
    const rejected = await handler(request());
    expect(rejected.status).toBe(429); expect(rejected.headers.get('Retry-After')).toBe('60');
    expect(load).toHaveBeenCalledTimes(1);
    time = 60_001; expect((await handler(request())).status).toBe(200);
  });
  it('never reaches the database for preflight or unsupported methods', async () => {
    const load = vi.fn(); const handler = createLandingStatsHandler(load);
    expect((await handler(request('OPTIONS'))).status).toBe(204);
    expect((await handler(request('POST'))).status).toBe(405);
    expect(load).not.toHaveBeenCalled();
  });
  it('hides backend errors and cools down failed refreshes', async () => {
    let time = 0; const load = vi.fn().mockRejectedValueOnce(Error('secret.internal: database details')).mockResolvedValue(stats);
    const handler = createLandingStatsHandler(load, () => time);
    const response = await handler(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret.internal');
    await handler(request()); expect(load).toHaveBeenCalledTimes(1);
    time = 5001; expect((await handler(request())).status).toBe(200);
  });
  it('rejects invalid or user-shaped database responses', async () => {
    const handler = createLandingStatsHandler(async () => ({ completed_trips: -1, avg_rating: NaN }));
    expect((await handler(request())).status).toBe(503);
  });
});
