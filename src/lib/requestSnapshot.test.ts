import { expect, it } from 'vitest';
import type { Tables } from './database.types';
import { mergeRequestSnapshot } from './requestSnapshot';
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
