// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AuthGuard from './AuthGuard';
const state = vi.hoisted(() => ({ user: { id: 'a', role: 'SUPER_ADMIN' }, companyId: 'one', companyLoading: false, profileError: null as string | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ ...state, loading: false, session: null, refreshProfile: vi.fn() }) }));
vi.mock('@/pages/admin/components/AdminCompanyContext', () => ({ useAdminCompany: () => ({ companyId: state.companyId, companies: [], loading: state.companyLoading }) }));
vi.mock('./LegalAcceptanceNotice', () => ({ default: () => null }));
function Draft() { const [value, setValue] = useState(''); return <input aria-label="draft" value={value} onChange={event => setValue(event.target.value)} />; }
const tree = () => <MemoryRouter><AuthGuard><Draft /></AuthGuard></MemoryRouter>;
beforeEach(() => { state.user = { id: 'a', role: 'SUPER_ADMIN' }; state.companyId = 'one'; state.companyLoading = false; state.profileError = null; });
afterEach(cleanup);
it('discards a form draft immediately when company changes', () => {
  const view = render(tree());
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'old-company-price' } });
  state.companyId = 'two'; view.rerender(tree());
  expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('');
});
it('preserves a draft across same-account background refresh', () => {
  const view = render(tree());
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'keep' } });
  state.user = { ...state.user }; view.rerender(tree());
  expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('keep');
});

it('does not discard a platform-wide form when the available company context changes', () => {
  const globalTree = () => <MemoryRouter><AuthGuard companyScoped={false}><Draft /></AuthGuard></MemoryRouter>;
  const view = render(globalTree());
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'new-company' } });
  state.companyId = 'two'; view.rerender(globalTree());
  expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('new-company');
});

it('waits for the first company scope so a ready page does not reset after the user interacts', () => {
  state.companyLoading = true; state.companyId = '';
  const view = render(tree());
  expect(screen.queryByLabelText('draft')).toBeNull();
  expect(screen.getByRole('status')).toBeTruthy();
  state.companyLoading = false; state.companyId = 'one'; view.rerender(tree());
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'selected-tab' } });
  view.rerender(tree());
  expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('selected-tab');
});
