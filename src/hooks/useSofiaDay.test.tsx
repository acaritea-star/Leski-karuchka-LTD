// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { sofiaDay, useSofiaDay } from './useSofiaDay';
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('uses Sofia calendar days across the autumn DST boundary', () => {
  expect(sofiaDay(new Date('2026-10-25T21:30:00Z'))).toBe('2026-10-25');
  expect(sofiaDay(new Date('2026-10-25T22:00:00Z'))).toBe('2026-10-26');
});
it('changes the daily cache key after midnight and clears its timer on unmount', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T21:59:30Z'));
  const { result, unmount } = renderHook(useSofiaDay);
  expect(result.current).toBe('2026-10-25');
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(result.current).toBe('2026-10-26'); unmount(); expect(vi.getTimerCount()).toBe(0);
});
