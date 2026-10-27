// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadRidePayment, ridePaymentAction, type RidePaymentState } from '@/lib/ridePayment';
import CustomerRidePayment from './CustomerRidePayment';
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'customer' } }) }));
vi.mock('@/lib/ridePayment', async original => ({ ...await original<typeof import('@/lib/ridePayment')>(), loadRidePayment: vi.fn(), ridePaymentAction: vi.fn() }));
const elements = vi.hoisted(() => vi.fn());
vi.mock('./RidePaymentElements', () => ({ default: (props: unknown) => { elements(props); return null; } }));
const state = (overrides: Partial<RidePaymentState> = {}): RidePaymentState => ({ request_id: 'ride', eligible: false, inline_available: false,
  environment: 'live', ended_at: '2026-10-23T19:24:46Z', amount: 3.24, state: 'none', payment_status: 'pending', payment_method: 'cash', ...overrides });
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false } } });
  render(<QueryClientProvider client={client}><CustomerRidePayment requestId="ride" price={3.24} endedAt="2026-10-23T19:24:46Z" /></QueryClientProvider>);
  return client;
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());
it('does not claim online payment is disabled before the server has answered', async () => {
  let answer!: (value: RidePaymentState) => void;
  vi.mocked(loadRidePayment).mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  show();
  expect(screen.queryByText(/Онлайн плащането не е включено/)).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Проверяваме начините за плащане');
  await act(async () => answer(state()));
});
it('shows a failed eligibility check as a retry, without directing the customer to pay twice', async () => {
  vi.mocked(loadRidePayment).mockRejectedValue(new Error('network'));
  show();
  await screen.findByRole('button', { name: 'Обнови възможностите за плащане' });
  expect(screen.queryByText(/Плати на шофьора/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Обнови възможностите за плащане' })).toBeTruthy();
});
for (const [method, label] of [['cash', 'Платено в брой'], ['card', 'Платено с карта на шофьора']]) {
  it(`shows the verified ${method} receipt without asking for another payment`, async () => {
    vi.mocked(loadRidePayment).mockResolvedValue(state({ payment_status: 'paid', payment_method: method }));
    show();
    expect(await screen.findByText(label)).toBeTruthy(); expect(screen.queryByText(/Плати на шофьора/)).toBeNull();
  });
}
it('refreshes server eligibility when an installed app resumes even if its ride row is unchanged', async () => {
  vi.mocked(loadRidePayment).mockResolvedValue(state());
  const client = show(); await act(async () => { await client.refetchQueries(); });
  expect(screen.queryByRole('button', { name: 'Тествай плащане с карта' })).toBeNull();
  vi.mocked(loadRidePayment).mockResolvedValue(state({ eligible: true, environment: 'test' }));
  await act(async () => { fireEvent(window, new Event('pageshow')); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Тествай плащане с карта' })).toBeTruthy());
});
it('keeps cash available in sandbox and only creates the card session after an explicit card choice', async () => {
  vi.mocked(loadRidePayment).mockResolvedValue(state({ eligible: true, inline_available: true, environment: 'test' }));
  show();
  await screen.findByRole('button', { name: 'Плащане в брой' });
  await waitFor(() => expect(elements).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, open: false })));
  expect(ridePaymentAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Тествай плащане с карта' }));
  await waitFor(() => expect(elements).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, open: true })));
});
for (const environment of ['test', 'live'] as const) {
  it(`checks cancellation before directing ${environment} customers to pay cash`, async () => {
    vi.mocked(loadRidePayment).mockResolvedValue(state({ eligible: true, environment, state: 'open' }));
    vi.mocked(ridePaymentAction).mockResolvedValue({ state: 'canceled', environment });
    show(); fireEvent.click(await screen.findByRole('button', { name: 'Плащане в брой' }));
    expect(await screen.findByText('Плати в брой на шофьора. Той ще потвърди получената сума.')).toBeTruthy();
    expect(ridePaymentAction).toHaveBeenCalledExactlyOnceWith('ride', 'cancel');
  });
}
for (const outcome of ['processing', 'paid', 'error'] as const) {
  it(`does not promise cash fallback when online cancellation returns ${outcome}`, async () => {
    vi.mocked(loadRidePayment).mockResolvedValue(state({ eligible: true, state: 'open' }));
    if (outcome === 'error') vi.mocked(ridePaymentAction).mockRejectedValue(new Error('Няма проверка'));
    else vi.mocked(ridePaymentAction).mockResolvedValue({ state: outcome, environment: 'live' });
    show(); fireEvent.click(await screen.findByRole('button', { name: 'Плащане в брой' }));
    if (outcome === 'error') await screen.findByRole('alert');
    else await screen.findByText(outcome === 'paid' ? 'Платено онлайн' : /Изчакай потвърждението, преди да платиш в брой/);
    expect(screen.queryByText(/Плати в брой на шофьора\./)).toBeNull();
  });
}
