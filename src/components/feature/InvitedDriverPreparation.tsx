import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSignOut } from '@/hooks/useSignOut';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { workflowError } from '@/lib/driverDocuments';
import type { PartnerAccess } from '@/lib/partnerAccess';
import DriverOnboarding from './DriverOnboarding';

export default function InvitedDriverPreparation({ access, onRefresh }: { access: PartnerAccess; onRefresh: () => Promise<unknown> }) {
  const { user } = useAuth();
  const { logout, pending } = useSignOut();
  const [application, setApplication] = useState(access.application_id);
  const confirmedApplication = access.application_id || application;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latch = useRef(false);
  return <main className="brand-scope min-h-[100dvh] bg-background-50 p-4 sm:p-8"><div className="max-w-2xl mx-auto space-y-5">
    <div className="flex items-center justify-between gap-4"><Link to="/" className="font-heading font-semibold">Лески Каручка</Link><button onClick={logout} disabled={pending} className="text-xs underline">Изход</button></div>
    <section className="bg-white border border-background-200 rounded-2xl p-5 space-y-3"><h1 className="font-heading text-xl font-semibold">Подготовка за {access.company_name}</h1>
      <p className="text-sm text-foreground-600">1. Твои данни → 2. Права и обучение → 3. Документи и автомобил → 4. Едно одобрение от фирмата.</p>
      <p className="text-xs text-foreground-500">Напредъкът по условията, обучението и документите се запазва. След одобрението ще можеш да включиш онлайн режима.</p>
      {confirmedApplication ? <DriverOnboarding applicationId={confirmedApplication} onReviewed={() => { void onRefresh(); }} /> : <form aria-label="Данни на поканения шофьор" className="space-y-3" onSubmit={async e => {
        e.preventDefault(); if (latch.current) return;
        const f = new FormData(e.currentTarget); latch.current = true; setBusy(true); setError('');
        try {
          const { data, error } = await withRequestTimeout(signal => supabase.rpc('begin_driver_onboarding', {
            p_company: access.company_id!, p_full_name: String(f.get('name')).trim(), p_phone: String(f.get('phone')).trim(),
            p_experience: String(f.get('experience')), p_has_vehicle: f.get('vehicle') === 'own', p_message: '',
          }).abortSignal(signal));
          if (error) throw error; if (!data) throw new Error('Подготовката не е потвърдена.');
          setApplication(data); void onRefresh();
        } catch (e) { setError(workflowError(e, 'Провери статуса преди повторен опит.')); void onRefresh(); }
        finally { latch.current = false; setBusy(false); }
      }}>
        <label className="block text-sm">Име и фамилия<input name="name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={[user?.first_name, user?.last_name].filter(Boolean).join(' ')} disabled={busy} className="block w-full mt-1 p-3 border border-background-200 rounded-xl" /></label>
        <label className="block text-sm">Телефон<input name="phone" type="tel" required minLength={6} maxLength={30} autoComplete="tel" defaultValue={user?.phone ?? ''} disabled={busy} className="block w-full mt-1 p-3 border border-background-200 rounded-xl" /></label>
        <label className="block text-sm">Опит като шофьор<select name="experience" required disabled={busy} className="block w-full mt-1 p-3 border border-background-200 rounded-xl"><option value="">Избери</option>{['1–3', '3–5', '5–10', '10+'].map(v => <option key={v} value={v}>{v} години</option>)}</select></label>
        <label className="block text-sm">Автомобил<select name="vehicle" disabled={busy} className="block w-full mt-1 p-3 border border-background-200 rounded-xl"><option value="company">Фирмата ще ми назначи автомобил</option><option value="own">Имам собствен автомобил</option></select></label>
        <p className="text-xs text-foreground-500">При собствен автомобил ще качиш книжка, застраховка и регистрация. При фирмен автомобил качваш книжката; фирмата осигурява автомобила и валидната му застраховка при общото одобрение.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="w-full bg-primary-500 text-white rounded-xl p-3 disabled:opacity-60">{busy ? 'Запазваме…' : 'Запази и продължи към обучението'}</button>
      </form>}
    </section>
  </div></main>;
}
