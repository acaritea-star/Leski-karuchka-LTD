import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { workflowError } from '@/lib/driverDocuments';
import { invitationUrl, type PartnerKind } from '@/lib/partnerAccess';

export default function PartnerInvitations({ kind, companyId }: { kind: PartnerKind; companyId?: string }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const key = ['partner-invitations', user?.id, kind, companyId];
  const [email, setEmail] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const latch = useRef(false), intent = useRef<{ email: string; id: string } | null>(null);
  const allowed = !!user && (kind === 'company' ? user.role === 'SUPER_ADMIN' : !!companyId && (user.role === 'SUPER_ADMIN' || user.role === 'COMPANY_ADMIN' && user.company_id === companyId));
  const query = useQuery({ queryKey: key, enabled: allowed, staleTime: 15_000, retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => {
        let request = supabase.from('partner_invitations').select('id,kind,email,status,expires_at,email_status,email_error,company_id').eq('kind', kind);
        request = companyId ? request.eq('company_id', companyId) : request;
        return request.order('created_at', { ascending: false }).limit(30).abortSignal(abort);
      }, 10_000, signal);
      if (error) throw error; return data ?? [];
    },
  });
  async function send(id: string, resend = false) {
    const { data, error } = await withRequestTimeout(() => supabase.functions.invoke('partner-invitation-email', { body: { invitation_id: id, resend } }), 30_000);
    if (error) throw new Error('Изпращането не е потвърдено. Поканата е запазена — провери статуса или копирай личния линк.');
    if (data?.status === 'sent') setNotice('Поканата е изпратена по имейл. Очаква вход с поканения акаунт.');
    else if (data?.status === 'sending') setNotice('Поканата е запазена. Изпращането се обработва — обнови статуса.');
    else throw new Error(data?.message || 'Имейлът не е изпратен. Можеш да използваш личния линк.');
  }
  async function action(operation: () => Promise<unknown>) {
    if (latch.current) return; latch.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e) { setError(workflowError(e, 'Провери статуса преди повторен опит.')); }
    finally { latch.current = false; setBusy(false); void client.invalidateQueries({ queryKey: key }); }
  }
  if (!allowed) return <p role="alert">За покана е необходим достъп до конкретната фирма.</p>;
  return <section className="space-y-4 text-sm">
    <p>{kind === 'company' ? 'Добави само имейла на представителя. След входа той попълва фирмените данни и тарифите.' : 'Покани шофьора с точния имейл за Google или Facebook. След входа той преминава подготовката и изпраща един комплект за одобрение.'}</p>
    <form className="flex flex-col sm:flex-row gap-2" onSubmit={e => { e.preventDefault(); void action(async () => {
      const normalized = email.trim().toLowerCase();
      if (!intent.current || intent.current.email !== normalized) intent.current = { email: normalized, id: crypto.randomUUID() };
      const { data: id, error } = await withRequestTimeout(signal => supabase.rpc('create_partner_invitation', {
        p_id: intent.current!.id, p_kind: kind, p_email: normalized, p_company: companyId,
      }).abortSignal(signal));
      if (error) throw error; if (!id) throw new Error('Поканата не е потвърдена.');
      // Creation is confirmed. A later email failure must not keep an old
      // operation ID alive after the invitation is revoked or expires.
      intent.current = null;
      setNotice('Поканата е запазена. Изпращаме имейла…');
      await send(id); setEmail(''); intent.current = null;
    }); }}>
      <label className="flex-1">{kind === 'company' ? 'Имейл на представителя' : 'Имейл на шофьора'}<input type="email" required maxLength={254} value={email} disabled={busy} onChange={e => setEmail(e.target.value)} autoComplete="off" className="block w-full p-3 mt-1 border border-background-200 rounded-xl" /></label>
      <button disabled={busy || !email.trim()} className="self-end px-5 py-3 rounded-xl bg-primary-500 text-white disabled:opacity-50">{busy ? 'Обработваме…' : 'Изпрати покана'}</button>
    </form>
    {error && <p role="alert" className="text-red-600">{error}</p>}{notice && <p role="status" className="text-accent-700">{notice}</p>}
    <button onClick={() => void query.refetch()} disabled={busy || query.isFetching} className="underline text-primary-700">Обнови статуса</button>
    {query.isPending ? <p role="status">Зареждане…</p> : query.isError ? <p role="alert">Поканите не са заредени. Опитай отново.</p> : query.data?.map(i => {
      const active = i.status === 'pending' && Date.parse(i.expires_at) > Date.now();
      return <div key={i.id} className="border border-background-200 rounded-xl p-3 space-y-2">
        <p className="font-semibold break-all">{i.email}</p>
        <p>{i.status === 'accepted' ? 'Приета' : i.status === 'revoked' ? 'Отменена' : active ? 'Очаква вход' : 'Изтекла'} · {i.email_status === 'sent' ? 'Имейлът е изпратен' : i.email_status === 'sending' ? 'Изпращането се обработва' : i.email_status === 'failed' ? 'Имейлът не е изпратен' : 'Имейлът още не е изпратен'}</p>
        {active && <>
          <label className="block text-xs">Личен линк (работи само с поканения имейл)<input readOnly value={invitationUrl(kind, i.id)} onFocus={e => e.target.select()} className="block w-full mt-1 p-2 rounded-lg border border-background-200 text-xs" /></label>
          <div className="flex flex-wrap gap-4"><button disabled={busy} onClick={() => void action(() => send(i.id, true))} className="underline text-primary-700">{i.email_status === 'sent' ? 'Изпрати отново' : 'Изпрати имейл'}</button>
            <button disabled={busy} onClick={() => void action(async () => { const { error } = await withRequestTimeout(signal => supabase.rpc('revoke_partner_invitation', { p_id: i.id }).abortSignal(signal)); if (error) throw error; setNotice('Поканата е отменена.'); })} className="underline text-red-600">Отмени поканата</button></div>
        </>}
      </div>;
    })}
    <p className="text-xs text-foreground-500">Поканата важи 14 дни. Непоканен акаунт не получава партньорски достъп. Само одобреният шофьор може да приема заявки.</p>
  </section>;
}
