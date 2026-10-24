// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import type { Tables } from '@/lib/database.types';
import '@/i18n';
import CancelRideButton from './CancelRideButton';
const fake = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock('@/lib/rideOperations', () => ({ cancelTaxiRequest: fake.cancel }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'customer' } }) }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const ride = (status: Tables<'taxi_requests'>['status'] = 'accepted') => ({ id: 'ride', status });
const wrapper = (client: QueryClient) => ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
it.each(['in_progress', 'completed', 'cancelled'] as const)('does not offer customer cancellation for %s', status => {
  render(<CancelRideButton request={ride(status)} />, { wrapper: wrapper(new QueryClient()) });
  expect(screen.queryByRole('button')).toBeNull();
});
it('sends a single confirmed cancellation on rapid taps and applies only the server receipt', async () => {
  const client = new QueryClient(), onCancelled = vi.fn();
  client.setQueryData(queryKeys.customerOrders('customer'), [ride()]);
  let finish!: (row: unknown) => void;
  fake.cancel.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<CancelRideButton request={ride()} onCancelled={onCancelled} />, { wrapper: wrapper(client) });
  fireEvent.click(screen.getByRole('button', { name: 'Отмени заявката' }));
  const confirm = screen.getByRole('button', { name: 'Да, отмени' });
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(fake.cancel).toHaveBeenCalledTimes(1); expect(onCancelled).not.toHaveBeenCalled();
  expect(client.getQueryData(queryKeys.customerOrders('customer'))).toEqual([ride()]);
  const receipt = { ...ride(), status: 'cancelled' };
  await act(async () => finish(receipt));
  expect(onCancelled).toHaveBeenCalledWith(receipt);
  expect(client.getQueryData(queryKeys.customerOrders('customer'))).toEqual([receipt]);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps a failed cancellation open and does not manufacture a cancelled ride', async () => {
  fake.cancel.mockRejectedValue(new Error('offline')); const changed = vi.fn();
  render(<CancelRideButton request={ride()} onCancelled={changed} />, { wrapper: wrapper(new QueryClient()) });
  fireEvent.click(screen.getByRole('button', { name: 'Отмени заявката' }));
  fireEvent.click(screen.getByRole('button', { name: 'Да, отмени' }));
  expect(await screen.findByRole('alert')).toBeTruthy(); expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
});
it('closes stale confirmation when the driver starts the ride', () => {
  const view = render(<CancelRideButton request={ride()} />, { wrapper: wrapper(new QueryClient()) });
  fireEvent.click(screen.getByRole('button', { name: 'Отмени заявката' }));
  view.rerender(<CancelRideButton request={ride('in_progress')} />);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(fake.cancel).not.toHaveBeenCalled();
});
