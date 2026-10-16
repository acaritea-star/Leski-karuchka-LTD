// @vitest-environment jsdom
import { cleanup, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import StaffMfaBoundary from './StaffMfaBoundary';
import { STAFF_MFA_REQUIRED_EVENT } from '@/lib/staffMfa';
const state = vi.hoisted(() => ({ role: 'DRIVER', token: '', clear: vi.fn(), gps: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'staff', role: state.role }, session: { access_token: state.token } }) }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { clear: state.clear } }));
vi.mock('@/lib/sharedGps', () => ({ stopSharedGps: state.gps }));
vi.mock('@/lib/driverLocation', () => ({ stopDriverGps: vi.fn() }));
vi.mock('./StaffMfa', () => ({ default: () => <p>mfa-required</p> }));
const token = (aal: string) => `x.${btoa(JSON.stringify({ aal }))}.x`;
beforeEach(() => { state.role = 'DRIVER'; state.token = token('aal1'); vi.clearAllMocks(); });
afterEach(cleanup);
it('does not mount staff data before the second factor', async () => {
  render(<StaffMfaBoundary><p>private-screen</p></StaffMfaBoundary>);
  await screen.findByText('mfa-required'); expect(screen.queryByText('private-screen')).toBeNull(); expect(state.gps).toHaveBeenCalled();
});
it('keeps customer first-factor access without loading MFA', () => {
  state.role = 'CUSTOMER'; render(<StaffMfaBoundary><p>customer-screen</p></StaffMfaBoundary>);
  expect(screen.getByText('customer-screen')).toBeTruthy(); expect(state.clear).not.toHaveBeenCalled();
});
it('accepts verified presentation state but locks on a matching server denial', async () => {
  state.token = token('aal2'); render(<StaffMfaBoundary><p>private-screen</p></StaffMfaBoundary>);
  expect(screen.getByText('private-screen')).toBeTruthy();
  act(() => window.dispatchEvent(new CustomEvent(STAFF_MFA_REQUIRED_EVENT, { detail: 'old-token' })));
  expect(screen.getByText('private-screen')).toBeTruthy();
  act(() => window.dispatchEvent(new CustomEvent(STAFF_MFA_REQUIRED_EVENT, { detail: state.token })));
  await screen.findByText('mfa-required'); expect(screen.queryByText('private-screen')).toBeNull();
});
it('unmounts protected content when the session drops to aal1', async () => {
  state.token = token('aal2'); const result = render(<StaffMfaBoundary><p>private-screen</p></StaffMfaBoundary>);
  state.token = token('aal1'); result.rerender(<StaffMfaBoundary><p>private-screen</p></StaffMfaBoundary>);
  await screen.findByText('mfa-required'); expect(screen.queryByText('private-screen')).toBeNull();
});
