// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PartnerInvitations from './PartnerInvitations';
const api = vi.hoisted(() => ({ rpc: vi.fn(), mail: vi.fn(), invitations: [] as Record<string, unknown>[] }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'root', role: 'SUPER_ADMIN' } }) }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: (name: string, args: unknown) => ({ abortSignal: () => api.rpc(name, args) }),
  functions: { invoke: api.mail },
  from: () => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
      abortSignal: () => Promise.resolve({ data: [...api.invitations], error: null }) };
    return query;
  },
} }));
let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PartnerInvitations kind="company" /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); api.invitations = [];
  api.rpc.mockImplementation((name, args) => {
    if (name === 'revoke_partner_invitation') {
      api.invitations = api.invitations.map(i => i.id === args.p_id ? { ...i, status: 'revoked' } : i);
      return Promise.resolve({ error: null });
    }
    // Model the server's operation ID and active email deduplication.
    let invitation = api.invitations.find(i => i.id === args.p_id || i.email === args.p_email && i.status === 'pending');
    if (!invitation) {
      invitation = { id: args.p_id, email: args.p_email, kind: 'company', status: 'pending', email_status: 'failed', expires_at: new Date(Date.now() + 86400000).toISOString() };
      api.invitations.push(invitation);
    }
    return Promise.resolve({ data: invitation.id, error: null });
  });
  api.mail.mockResolvedValue({ data: { status: 'sent' }, error: null });
});
afterEach(() => { cleanup(); client?.clear(); });

it('creates a fresh personal link after mail failure and revocation of the saved invitation', async () => {
  api.mail.mockResolvedValueOnce({ data: null, error: new TypeError('Offline') });
  mount();
  fireEvent.change(screen.getByLabelText('Имейл на представителя'), { target: { value: 'synthetic@example.invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Изпрати покана' }));
  await screen.findByRole('alert');
  const oldId = api.invitations[0].id;
  fireEvent.click(await screen.findByRole('button', { name: 'Отмени поканата' }));
  await screen.findByText('Поканата е отменена.');
  fireEvent.click(screen.getByRole('button', { name: 'Изпрати покана' }));
  await screen.findByText('Поканата е изпратена по имейл. Очаква вход с поканения акаунт.');
  expect(api.invitations).toHaveLength(2);
  const newId = api.invitations.find(i => i.status === 'pending')!.id;
  expect(newId).not.toBe(oldId);
  expect(api.mail.mock.calls[1][1].body.invitation_id).toBe(newId);
});
it('keeps the operation ID when creation itself has an uncertain result', async () => {
  api.rpc.mockResolvedValueOnce({ data: null, error: new TypeError('Lost creation reply') });
  mount();
  fireEvent.change(screen.getByLabelText('Имейл на представителя'), { target: { value: 'synthetic@example.invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Изпрати покана' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Изпрати покана' }));
  await waitFor(() => expect(api.mail).toHaveBeenCalledTimes(1));
  expect(api.rpc.mock.calls[0][1].p_id).toBe(api.rpc.mock.calls[1][1].p_id);
});
