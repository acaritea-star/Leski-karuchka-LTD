import { QueryClient } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { Tables } from './database.types';
import { cacheDriverRequest } from './driverRequestCache';
import { queryKeys } from './queryKeys';
const row = (id: string, status: Tables<'taxi_requests'>['status']) => ({ id, driver_id: 'driver', status } as Tables<'taxi_requests'>);
it('does not reopen a completed ride after a late accept acknowledgement', () => {
  const client = new QueryClient();
  cacheDriverRequest(client, 'driver', row('ride', 'accepted'));
  cacheDriverRequest(client, 'driver', row('ride', 'completed'));
  cacheDriverRequest(client, 'driver', row('ride', 'accepted'));
  expect(client.getQueryData(queryKeys.driverActiveRequest('driver'))).toBeNull(); client.clear();
});
it('keeps a newer ride when an old terminal event or mutation reply arrives', () => {
  const client = new QueryClient();
  cacheDriverRequest(client, 'driver', row('old', 'completed'));
  cacheDriverRequest(client, 'driver', row('new', 'accepted'));
  cacheDriverRequest(client, 'driver', row('old', 'completed'));
  cacheDriverRequest(client, 'driver', row('old', 'arrived'));
  expect(client.getQueryData(queryKeys.driverActiveRequest('driver'))).toMatchObject({ id: 'new', status: 'accepted' }); client.clear();
});
it('refreshes the wallet once per settlement and again for each partial refund, never for an old duplicate', () => {
  const client = new QueryClient(), invalidate = vi.spyOn(client, 'invalidateQueries');
  const paid = { ...row('ride', 'completed'), payment_status: 'paid', online_payment_state: 'paid', updated_at: '2026-10-25T12:00:00Z' } as Tables<'taxi_requests'>;
  cacheDriverRequest(client, 'driver', paid);
  cacheDriverRequest(client, 'driver', { ...paid });
  expect(invalidate).toHaveBeenCalledTimes(1);
  const refund = { ...paid, payment_status: 'refunded', online_payment_state: 'partially_refunded', updated_at: '2026-10-25T12:01:00Z' } as Tables<'taxi_requests'>;
  cacheDriverRequest(client, 'driver', refund);
  cacheDriverRequest(client, 'driver', { ...refund, updated_at: '2026-10-25T12:02:00Z' });
  cacheDriverRequest(client, 'driver', paid);
  expect(invalidate).toHaveBeenCalledTimes(3); client.clear();
});
