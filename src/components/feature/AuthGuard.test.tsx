// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AuthGuard from './AuthGuard';
const state = vi.hoisted(() => ({ user: { id: 'a', role: 'SUPER_ADMIN' }, companyId: 'one', profileError: null as string | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ ...state, loading: false, session: null, refreshProfile: vi.fn() }) }));
vi.mock('@/pages/admin/components/AdminCompanyContext', () => ({ useAdminCompany: () => ({ companyId: state.companyId }) }));
vi.mock('./LegalAcceptanceNotice', () => ({ default: () => null }));
function Draft() { const [value, setValue] = useState(''); return <input aria-label="draft" value={value} onChange={event => setValue(event.target.value)} />; }
const tree = () => <MemoryRouter><AuthGuard><Draft /></AuthGuard></MemoryRouter>;
beforeEach(() => { state.user = { id: 'a', role: 'SUPER_ADMIN' }; state.companyId = 'one'; state.profileError = null; });
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
