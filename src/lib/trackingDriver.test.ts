import { QueryClient } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ queries: vi.fn(), profile: vi.fn(), vehicle: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from: (table: string) => {
  const q = { select: (fields: string) => { fake.queries(table, fields); return q; }, eq: () => q, abortSignal: () => q,
    maybeSingle: () => table === 'drivers' ? Promise.resolve({ data: { user_id: 'driver-user', vehicle_id: 'car', rating: 4.8, total_trips: 10 }, error: null })
      : table === 'profiles' ? fake.profile() : fake.vehicle() }; return q;
} } }));
import { trackingDriverOptions } from './trackingDriver';
it('loads independent profile and vehicle reads together, embeds category, and reuses the per-viewer ride cache', async () => {
  let finishProfile!: (value: unknown) => void, finishVehicle!: (value: unknown) => void;
  fake.profile.mockReturnValueOnce(new Promise(resolve => { finishProfile = resolve; }));
  fake.vehicle.mockReturnValueOnce(new Promise(resolve => { finishVehicle = resolve; }));
  const client = new QueryClient();
  const pending = client.fetchQuery(trackingDriverOptions('customer', 'ride', 'driver'));
  await vi.waitFor(() => expect(fake.vehicle).toHaveBeenCalledOnce());
  expect(fake.profile).toHaveBeenCalledOnce(); // Vehicle does not wait for profile.
  finishProfile({ data: { first_name: 'Тест', last_name: 'Шофьор', phone: 'test', avatar_url: null }, error: null });
  finishVehicle({ data: { make: 'Test', model: 'Car', color: null, registration_number: 'fixture', vehicle_type: { name: 'Comfort' } }, error: null });
  expect(await pending).toMatchObject({ info: { name: 'Тест Шофьор' }, vehicleType: 'comfort' });
  await client.fetchQuery(trackingDriverOptions('customer', 'ride', 'driver'));
  expect(fake.queries).toHaveBeenCalledTimes(3);
  expect(trackingDriverOptions('another', 'ride', 'driver').queryKey).not.toEqual(trackingDriverOptions('customer', 'ride', 'driver').queryKey);
  client.clear();
});
