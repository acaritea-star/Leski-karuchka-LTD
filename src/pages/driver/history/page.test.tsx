// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import DriverHistory from './page';
const state = vi.hoisted(() => ({ driverError: false, tripsError: false, trips: [] as unknown[], retry: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'driver-user' } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ queryOptions: (options: unknown) => options,
  useQuery: (options: { queryKey: string[] }) => options.queryKey[0] === 'drivers'
    ? { data: { id: 'driver' }, isLoading: false, isError: state.driverError, refetch: state.retry }
    : { data: state.trips, isLoading: false, isError: state.tripsError, refetch: state.retry },
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
beforeEach(() => { state.driverError = false; state.tripsError = false; state.trips = []; vi.clearAllMocks(); });
afterEach(cleanup);
it.each(['driverError', 'tripsError'] as const)('shows a recoverable error for %s instead of an empty history', key => {
  state[key] = true;
  render(<DriverHistory />);
  expect(screen.getByRole('alert').textContent).toContain('Историята не се зареди');
  fireEvent.click(screen.getByRole('button', { name: 'Опитай отново' }));
  expect(state.retry).toHaveBeenCalledOnce();
});
it('preserves a zero final fare and does not show a cancelled estimate as earnings', () => {
  state.trips = [
    { id: 'zero', status: 'completed', pickup_address: 'Start', destination_address: 'End', final_price: 0, estimated_price: 99 },
    { id: 'cancel', status: 'cancelled', pickup_address: 'Other', destination_address: 'End', final_price: null, estimated_price: 88 },
  ];
  render(<DriverHistory />);
  expect(screen.getByText(/^0\.00/)).toBeTruthy();
  expect(screen.queryByText(/99\.00|88\.00|NaN/)).toBeNull();
});
