import type { Tables } from './database.types';
type Snapshot = { id: string; status: Tables<'taxi_requests'>['status']; updated_at?: string };
const phase = { pending: 0, accepted: 1, arrived: 2, in_progress: 3, completed: 4, cancelled: 4 };
// A slow poll must not undo a newer Realtime transition or merge another ride.
export function mergeRequestSnapshot<T extends Snapshot>(current: T | null, incoming: T): T | null {
  if (!current || incoming.id !== current.id) return current;
  const before = Date.parse(current.updated_at ?? ''), after = Date.parse(incoming.updated_at ?? '');
  if (Number.isFinite(before) && Number.isFinite(after) && after < before) return current;
  if (phase[incoming.status] < phase[current.status]) return current;
  if ((current.status === 'completed' || current.status === 'cancelled') && incoming.status !== current.status) return current;
  if (Object.keys(incoming).every(key => incoming[key as keyof T] === current[key as keyof T])) return current;
  return { ...current, ...incoming };
}
