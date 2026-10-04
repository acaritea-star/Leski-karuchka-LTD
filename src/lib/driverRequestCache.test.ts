import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
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
