import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { withRequestTimeout } from '@/lib/requestTimeout';

type Factor = { id: string; friendly_name?: string; factor_type: string; status: string };
type Setup = { id: string; qr: string; secret: string };
const name = 'Лески Каручка';
const input = 'w-full min-h-12 rounded-xl border border-background-200 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary-300';
const button = 'min-h-12 rounded-xl bg-primary-600 px-4 py-3 font-semibold text-white disabled:opacity-50';

export default function StaffMfa({ management = false, onDone, onBusyChange }: { management?: boolean; onDone?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const { user, signOut, refreshProfile } = useAuth();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [selected, setSelected] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const lock = useRef(false);
  const alive = useRef(true);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data, error } = await withRequestTimeout(() => supabase.auth.mfa.listFactors());
      if (error) throw error;
      if (alive.current) { setFactors(data.all); setSelected(data.totp[0]?.id ?? ''); }
    } catch { if (alive.current) setError('Защитеният вход не се зареди. Провери връзката и опитай отново.'); }
    finally { if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (setup || selected && !management) codeInput.current?.focus({ preventScroll: true }); }, [setup, selected, management]);
  const assertOwner = async () => {
    const { data, error } = await withRequestTimeout(() => supabase.auth.getSession());
    if (error || !alive.current || data.session?.user.id !== user?.id) throw new Error('Account changed');
  };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setSuccess('');
    try { await assertOwner(); await action(); }
    catch (err) {
      if (alive.current) {
        const status = err && typeof err === 'object' && 'status' in err ? Number(err.status) : 0;
        setError(status === 429 ? 'Твърде много опити. Изчакай малко и опитай с нов код.' : 'Действието не е потвърдено. Провери връзката и актуалния код от приложението за удостоверяване.');
      }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const enroll = () => void run(async () => {
    // Only discard this application's incomplete setup. Never remove a verified factor.
    const { data: list, error: listError } = await withRequestTimeout(() => supabase.auth.mfa.listFactors());
    if (listError) throw listError;
    for (const factor of list.all.filter(f => f.factor_type === 'totp' && f.status === 'unverified' && f.friendly_name?.startsWith(name))) {
      await assertOwner();
      const { error } = await withRequestTimeout(() => supabase.auth.mfa.unenroll({ factorId: factor.id }));
      if (error) throw error;
    }
    await assertOwner();
    const { data, error } = await withRequestTimeout(() => supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `${name} ${new Date().toISOString().slice(0, 19)}`, issuer: name }));
    if (error) throw error;
    if (alive.current) { setSetup({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret }); setCode(''); }
  });
  const verify = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code) || !(setup?.id || selected)) return;
    void run(async () => {
      const { error } = await withRequestTimeout(() => supabase.auth.mfa.challengeAndVerify({ factorId: setup?.id || selected, code }));
      if (error) throw error;
      await refreshProfile();
      if (alive.current) { setSetup(null); setCode(''); setSuccess('Двуфакторното удостоверяване е потвърдено.'); }
      if (management) await load();
      onDone?.();
    });
  };
  const cancelSetup = () => void run(async () => {
    if (!setup) return;
    const { error } = await withRequestTimeout(() => supabase.auth.mfa.unenroll({ factorId: setup.id }));
    if (error) throw error;
    if (alive.current) { setSetup(null); setCode(''); }
  });
  const remove = (id: string) => void run(async () => {
    if (factors.filter(f => f.status === 'verified').length < 2) return;
    const { error } = await withRequestTimeout(() => supabase.auth.mfa.unenroll({ factorId: id }));
    if (error) throw error;
    // Refresh the token after factor changes; the server also checks the live Auth session.
    const refreshed = await supabase.auth.refreshSession(); if (refreshed.error) throw refreshed.error;
    await refreshProfile(); await load();
  });
  const verified = factors.filter(f => f.factor_type === 'totp' && f.status === 'verified');

  return <section aria-label="Двуфакторно удостоверяване" className="w-full max-w-md rounded-2xl border border-background-200 bg-white p-5 sm:p-7 space-y-5">
    <div><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Защитен служебен достъп</p>
      <h1 className="text-2xl font-bold mt-2">Двуфакторно удостоверяване</h1>
      <p className="text-sm text-foreground-600 mt-2">За шофьори, фирмени и супер администратори. Входът се потвърждава с код от приложение за удостоверяване.</p>
      {user?.email && <p className="text-xs text-foreground-500 mt-2 break-words">{user.email}</p>}
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
    {loading ? <p role="status" className="text-sm">Проверка на удостоверяването…</p> : <>
      {!setup && management && <div className="space-y-3">{verified.map(f => <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl bg-background-50 p-3 text-sm">
        <span className="break-words">{f.friendly_name || 'Приложение за удостоверяване'}</span>
        <button type="button" disabled={busy || verified.length < 2} onClick={() => remove(f.id)} className="min-h-11 shrink-0 text-red-700 underline disabled:opacity-40">Премахни</button>
      </div>)}<p className="text-xs text-foreground-500">Запази поне едно устройство. Можеш да добавиш второ приложение за резервен достъп.</p></div>}
      {!setup && (management || !verified.length) && <button type="button" disabled={busy || !!error && !factors.length} onClick={enroll} className={`${button} w-full`}>{management ? 'Добави резервно приложение' : 'Настрой двуфакторен вход'}</button>}
      {setup && <div className="space-y-3">
        <p className="text-sm">1. Сканирай QR кода с приложението за удостоверяване. На същия телефон можеш да въведеш ключа ръчно.</p>
        <img src={setup.qr.startsWith('data:image/svg+xml') ? setup.qr : ''} alt="QR код за приложението за удостоверяване" width="200" height="200" className="mx-auto max-w-full" />
        <details className="text-sm"><summary className="min-h-11 flex items-center cursor-pointer underline">Покажи ключа за ръчно въвеждане</summary><p className="rounded-xl bg-background-50 p-3 font-mono text-sm break-all select-all">{setup.secret}</p><p className="text-xs text-foreground-500 mt-2">Този ключ е личен. Не го изпращай на други хора.</p></details>
      </div>}
      {(setup || !management && verified.length > 0) && <form onSubmit={verify} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4 min-w-0">
          {!setup && verified.length > 1 && <label className="block text-sm font-medium">Приложение<select className={`${input} mt-1`} value={selected} onChange={e => setSelected(e.target.value)}>{verified.map(f => <option key={f.id} value={f.id}>{f.friendly_name || 'Приложение за удостоверяване'}</option>)}</select></label>}
          <label className="block text-sm font-medium">{setup ? '2. Въведи шестцифрения код' : 'Шестцифрен код'}<input ref={codeInput} className={`${input} mt-2 text-center tracking-[.25em] tabular-nums`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
          <button className={`${button} w-full`} disabled={code.length !== 6}>{busy ? 'Потвърждаване…' : setup ? 'Активирай и продължи' : 'Потвърди входа'}</button>
          {setup && <button type="button" onClick={cancelSetup} className="w-full min-h-11 text-sm underline">Откажи настройването</button>}
        </fieldset>
      </form>}
      {error && <button type="button" disabled={busy} onClick={() => void load()} className="min-h-11 text-sm underline">Провери отново</button>}
      <p className="text-xs text-foreground-500">При загубено устройство използвай резервното приложение или се свържи с поддръжката за проверка на самоличността.</p>
    </>}
    {!management && <button type="button" disabled={busy} onClick={() => void run(signOut)} className="min-h-11 w-full border-t border-background-100 pt-3 text-sm underline">Изход от профила</button>}
  </section>;
}
