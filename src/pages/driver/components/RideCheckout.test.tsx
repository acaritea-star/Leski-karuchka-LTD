// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadRidePayment, ridePaymentAction, type RidePaymentState } from '@/lib/ridePayment';
import { completeRidePayment, prepareCheckout, readCheckout } from '@/lib/rideCheckout';
import type { Tables } from '@/lib/database.types';
import RideCheckout from './RideCheckout';
vi.mock('@/lib/ridePayment', async original => ({ ...await original<typeof import('@/lib/ridePayment')>(), loadRidePayment: vi.fn(), ridePaymentAction: vi.fn() }));
vi.mock('@/lib/rideCheckout', async original => ({ ...await original<typeof import('@/lib/rideCheckout')>(), completeRidePayment: vi.fn() }));
const owner = '11111111-1111-4111-8111-111111111111', driverId = '22222222-2222-4222-8222-222222222222';
const request = { id: '33333333-3333-4333-8333-333333333333', driver_id: driverId, estimated_price: 2.97, status: 'in_progress' } as Tables<'taxi_requests'>;
const state = (overrides: Partial<RidePaymentState> = {}): RidePaymentState => ({ request_id: request.id, eligible: true, environment: 'test', ended_at: '2026-10-26T12:00:00Z', amount: 2.97, state: 'none', payment_status: 'pending', payment_method: 'cash', ...overrides });
function show() {
 const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
 const onFinished = vi.fn();
 const view = render(<QueryClientProvider client={client}><RideCheckout owner={owner} driverId={driverId} request={request} onClose={vi.fn()} onFinished={onFinished} /></QueryClientProvider>);
 return { ...view, client, onFinished };
}
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
afterEach(cleanup);
for (const environment of ['test', 'live'] as const) for (const choice of ['cash', 'card'] as const) {
 it(`records ${choice} once when online eligibility is ${environment}`, async () => {
  vi.mocked(loadRidePayment).mockResolvedValue(state({ environment }));
  let resolve!: (row: Tables<'taxi_requests'>) => void;
  vi.mocked(completeRidePayment).mockImplementation(() => new Promise(done => { resolve = done; }));
  const { onFinished } = show();
  const button = await screen.findByRole('button', { name: choice === 'cash' ? 'Получих в брой · приключи' : 'Получих на ПОС терминал · приключи' });
  fireEvent.click(button); fireEvent.click(button);
  expect(completeRidePayment).toHaveBeenCalledOnce();
  expect(readCheckout(owner)?.command.p_choice).toBe(choice);
  await act(async () => resolve({ ...request, status: 'completed' }));
  expect(onFinished).toHaveBeenCalledOnce(); expect(readCheckout(owner)).toBeNull();
 });
}
it('never exposes cash while the server payment check is unresolved or unavailable', async () => {
 vi.mocked(loadRidePayment).mockRejectedValue(new Error('offline')); show();
 expect(screen.queryByRole('button', { name: 'Получих в брой · приключи' })).toBeNull();
 await screen.findByRole('button', { name: 'Обнови плащането' });
 expect(screen.queryByRole('button', { name: 'Получих в брой · приключи' })).toBeNull();
});
it('keeps cash locked when a concurrent card confirmation is still processing', async () => {
 vi.mocked(loadRidePayment).mockResolvedValue(state({ state: 'processing' }));
 vi.mocked(ridePaymentAction).mockResolvedValue({ state: 'processing', environment: 'test' }); show();
 fireEvent.click(await screen.findByRole('button', { name: 'Провери и премини към плащане в брой' }));
 await screen.findByText(/Не приемай второ плащане/);
 expect(screen.queryByRole('button', { name: 'Получих в брой · приключи' })).toBeNull();
 expect(completeRidePayment).not.toHaveBeenCalled();
});
it('opens cash after verified cancellation and blocks new receipts after online payment', async () => {
 vi.mocked(loadRidePayment).mockResolvedValue(state({ state: 'open' }));
 vi.mocked(ridePaymentAction).mockImplementation(async () => { vi.mocked(loadRidePayment).mockResolvedValue(state({ state: 'canceled' })); return { state: 'canceled' }; });
 const { client } = show();
 fireEvent.click(await screen.findByRole('button', { name: 'Провери и премини към плащане в брой' }));
 await screen.findByRole('button', { name: 'Получих в брой · приключи' });
 vi.mocked(loadRidePayment).mockResolvedValue(state({ state: 'paid', payment_status: 'paid', payment_method: 'online' }));
 await act(async () => { await client.refetchQueries(); });
 expect(await screen.findByText('Тестово плащане успешно')).toBeTruthy();
 expect(screen.queryByRole('button', { name: 'Получих в брой · приключи' })).toBeNull();
});
it('retains the exact receipt identity after an uncertain network response and reload', async () => {
 vi.mocked(loadRidePayment).mockResolvedValue(state());
 vi.mocked(completeRidePayment).mockRejectedValue(new Error('Потвърждението се забави.'));
 const view = show(); fireEvent.click(await screen.findByRole('button', { name: 'Получих в брой · приключи' }));
 await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('забави'));
 const original = readCheckout(owner)!.command;
 view.unmount(); show();
 expect(await screen.findByRole('button', { name: 'Повтори същия запис' })).toBeTruthy();
 expect(prepareCheckout(driverId, { p_request_id: request.id, p_actor: owner, p_choice: 'cash', p_partial_amount: null, p_note: '' })).toEqual(original);
});
