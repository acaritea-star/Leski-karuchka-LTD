import { expect, it } from 'vitest';
import type { Tables } from './database.types';
import { mergeRequestSnapshot, mergeDriverActiveRead } from './requestSnapshot';
type Snapshot = { id: string; status: Tables<'taxi_requests'>['status']; updated_at?: string; driver_id: string };
const current: Snapshot = { id: 'ride', status: 'accepted' as const, updated_at: '2026-10-03T18:00:02Z', driver_id: 'driver' };
it('ignores delayed pending snapshots even if their timestamp is absent', () => {
  expect(mergeRequestSnapshot(current, { ...current, status: 'pending', updated_at: undefined })).toBe(current);
});
it('ignores older snapshots, another request and unchanged polling results', () => {
  expect(mergeRequestSnapshot(current, { ...current, updated_at: '2026-10-03T18:00:01Z' })).toBe(current);
  expect(mergeRequestSnapshot(current, { ...current, id: 'other' })).toBe(current);
  expect(mergeRequestSnapshot(current, { ...current })).toBe(current);
});
it('accepts a newer valid transition and never reopens a terminal ride', () => {
  const arrived: Snapshot = { ...current, status: 'arrived' as const, updated_at: '2026-10-03T18:00:03Z' };
  expect(mergeRequestSnapshot(current, arrived)).toEqual(arrived);
  const completed: Snapshot = { ...arrived, status: 'completed' as const };
  expect(mergeRequestSnapshot(completed, { ...completed, status: 'accepted' })).toBe(completed);
});
it('keeps a driver Realtime transition ahead of a delayed active-query response', () => {
  const started = { ...current };
  const realtime: Snapshot = { ...current, status: 'in_progress', updated_at: '2026-10-03T18:00:04Z' };
  expect(mergeDriverActiveRead(started, realtime, started)).toBe(realtime);
  expect(mergeDriverActiveRead(started, realtime, null)).toBe(realtime);
});
it('does not reopen a cancelled/completed driver ride or overwrite a newly assigned ride', () => {
  expect(mergeDriverActiveRead(current, null, current)).toBeNull();
  const next = { ...current, id: 'new-ride' };
  expect(mergeDriverActiveRead(current, next, current)).toBe(next);
});
it('accepts the first recovered ride and clears a ride when an uncontested server read is empty', () => {
  expect(mergeDriverActiveRead(undefined, undefined, current)).toBe(current);
  expect(mergeDriverActiveRead(null, null, current)).toBe(current);
  expect(mergeDriverActiveRead(current, current, null)).toBeNull();
});
