// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Tables } from '@/lib/database.types';
import AdminCancelRideButton from './AdminCancelRideButton';

const fake = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock('@/lib/rideOperations', () => ({
  ACTIVE_RIDE_STATUSES: ['pending', 'accepted', 'arrived', 'in_progress'],
  adminCancelTaxiRequest: fake.cancel,
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const ride = (status: Tables<'taxi_requests'>['status'] = 'in_progress') => ({ id: 'ride', status });
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Отмени курса' }));
const confirm = () => screen.getByRole('button', { name: 'Да, отмени курса' });

it.each(['completed', 'cancelled'] as const)('offers no cancellation for a closed %s ride', status => {
  render(<AdminCancelRideButton request={ride(status)} />);
  expect(screen.queryByRole('button')).toBeNull();
});

it.each(['pending', 'accepted', 'arrived', 'in_progress'] as const)('offers cancellation for an active %s ride', status => {
  render(<AdminCancelRideButton request={ride(status)} />);
  expect(screen.getByRole('button', { name: 'Отмени курса' })).toBeTruthy();
});

it('requires a reason before sending anything', () => {
  render(<AdminCancelRideButton request={ride()} />);
  open(); fireEvent.click(confirm());
  expect(screen.getByRole('alert').textContent).toContain('Избери причина');
  expect(fake.cancel).not.toHaveBeenCalled();
});

it('sends one cancellation with the chosen reason and reports the server receipt', async () => {
  let finish!: (row: unknown) => void;
  fake.cancel.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const done = vi.fn();
  render(<AdminCancelRideButton request={ride()} onCancelled={done} />);
  open();
  fireEvent.click(screen.getByLabelText('Шофьорът не е приключил курса'));
  const button = confirm();
  fireEvent.click(button); fireEvent.click(button);
  expect(fake.cancel).toHaveBeenCalledTimes(1);
  expect(fake.cancel).toHaveBeenCalledWith('ride', 'in_progress', 'admin_driver_unfinished');
  expect(done).not.toHaveBeenCalled();
  const receipt = { ...ride(), status: 'cancelled' };
  await act(async () => finish(receipt));
  expect(done).toHaveBeenCalledWith(receipt);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps the dialog open with a clear message when an online payment blocks it', async () => {
  fake.cancel.mockRejectedValue(new Error('Cancel and reconcile the online payment before canceling this ride'));
  const done = vi.fn();
  render(<AdminCancelRideButton request={ride()} onCancelled={done} />);
  open(); fireEvent.click(screen.getByLabelText('Друга причина')); fireEvent.click(confirm());
  expect((await screen.findByRole('alert')).textContent).toContain('онлайн плащане');
  expect(done).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('closes a stale dialog when the ride is closed elsewhere', () => {
  const view = render(<AdminCancelRideButton request={ride('accepted')} />);
  open();
  view.rerender(<AdminCancelRideButton request={ride('completed')} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(fake.cancel).not.toHaveBeenCalled();
});
