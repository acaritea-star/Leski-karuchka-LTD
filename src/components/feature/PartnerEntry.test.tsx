// @vitest-environment jsdom
import { Suspense } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), refresh: vi.fn(), navigate: vi.fn(),
  user: { id: 'first', email: 'first@example.invalid', role: 'CUSTOMER', company_id: null as string | null } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, loading: false, refreshProfile: mocks.refresh }) }));
vi.mock('@/hooks/useSignOut', () => ({ useSignOut: () => ({ logout: vi.fn(), pending: false }) }));
vi.mock('react-router-dom', async original => ({ ...await original<typeof import('react-router-dom')>(), useNavigate: () => mocks.navigate }));
vi.mock('@/lib/partnerAccess', () => ({ resolvePartnerAccess: mocks.resolve }));
vi.mock('./OpenDriverApplications', () => ({ default: ({ onChoose }: { onChoose: (value: unknown) => void }) => <button onClick={() => onChoose({ status: 'preparation', destination: '/driver/access', role: 'CUSTOMER', company_id: 'firm', company_name: 'Отворена фирма' })}>Избери отворена фирма</button> }));
vi.mock('./InvitedDriverPreparation', () => ({ default: ({ access, onRefresh }: { access: { application_id?: string; company_name: string }; onRefresh: () => unknown }) => <div><p>{access.company_name}</p><p>{access.application_id ?? 'Нова кандидатура'}</p><button onClick={() => void onRefresh()}>Обнови кандидатурата</button></div> }));
import PartnerEntry from './PartnerEntry';
const denied = { status: 'denied', reason: 'invitation_required', message: 'Лична покана е необходима.' };
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.user = { id: 'first', email: 'first@example.invalid', role: 'CUSTOMER', company_id: null }; });
function mount(path = '/driver/access') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><Suspense fallback="Зареждане"><PartnerEntry kind="driver" /></Suspense></QueryClientProvider></MemoryRouter>;
  const view = render(tree()); return () => view.rerender(tree());
}
it('uses the server application and approved destination after choosing an open firm', async () => {
  mocks.resolve.mockResolvedValue(denied); mount();
  fireEvent.click(await screen.findByText('Избери отворена фирма'));
  await screen.findByText('Нова кандидатура');
  mocks.resolve.mockResolvedValue({ status: 'preparation', destination: '/driver/access', role: 'CUSTOMER', company_id: 'firm', company_name: 'Отворена фирма', application_id: 'saved-application' });
  fireEvent.click(screen.getByText('Обнови кандидатурата')); await screen.findByText('saved-application');
  mocks.resolve.mockResolvedValue({ status: 'ready', destination: '/driver/home', role: 'DRIVER', company_id: 'firm' });
  fireEvent.click(screen.getByText('Обнови кандидатурата'));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/driver/home', { replace: true }));
  expect(mocks.refresh).toHaveBeenCalled();
});
it('does not carry a selected firm into another account', async () => {
  mocks.resolve.mockResolvedValue(denied); const rerender = mount();
  fireEvent.click(await screen.findByText('Избери отворена фирма')); await screen.findByText('Нова кандидатура');
  mocks.user = { ...mocks.user, id: 'second', email: 'second@example.invalid' }; rerender();
  await screen.findByText('Избери отворена фирма'); expect(screen.queryByText('Отворена фирма')).toBeNull();
});
it('does not replace a named invitation with public candidacy', async () => {
  mocks.resolve.mockResolvedValue(denied); mount('/driver/access?invite=11111111-1111-4111-8111-111111111111');
  await screen.findByRole('alert'); expect(screen.queryByText('Избери отворена фирма')).toBeNull();
});
