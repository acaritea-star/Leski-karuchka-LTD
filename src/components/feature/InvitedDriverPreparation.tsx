import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSignOut } from '@/hooks/useSignOut';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { workflowError } from '@/lib/driverDocuments';
import type { PartnerAccess } from '@/lib/partnerAccess';
import DriverOnboarding from './DriverOnboarding';
import PreparationProgress from './PreparationProgress';

export default function InvitedDriverPreparation({ access, onRefresh, onChooseCompany }: { access: PartnerAccess; onRefresh: () => Promise<unknown>; onChooseCompany?: () => void }) {
  const { user } = useAuth();
  const { logout, pending } = useSignOut();
  const [application, setApplication] = useState(access.application_id);
  const [ownVehicle, setOwnVehicle] = useState(false);
  const confirmedApplication = access.application_id || application;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latch = useRef(false);
  return <main className="brand-scope min-h-[100dvh] bg-background-50 p-4 sm:p-8"><div className="max-w-2xl mx-auto space-y-5">
    <div className="flex items-center justify-between gap-4"><Link to="/" className="font-heading font-semibold">Лески Каручка</Link><button onClick={logout} disabled={pending} className="text-xs underline">Изход</button></div>
    <section className="bg-white border border-background-200 rounded-2xl p-5 sm:p-7 space-y-6"><div className="space-y-3"><p className="text-sm font-semibold text-primary-700 break-words">{access.company_name}</p><h1 className={`font-heading font-bold text-foreground-950 leading-tight ${confirmedApplication ? 'text-2xl' : 'text-3xl'}`}>{confirmedApplication ? 'Твоят шофьорски профил' : 'Добре дошъл!'}</h1>
      {!confirmedApplication && <p className="text-base leading-relaxed text-foreground-700">Ще те водим стъпка по стъпка. Започни с данните си.</p>}
      <p className="text-sm text-foreground-600 break-all">Влизаш с: {user?.email}</p>
      <p className="text-sm leading-relaxed text-foreground-500">Запазеното остава. Можеш да продължиш по-късно със същия профил.</p></div>
      {!confirmedApplication && onChooseCompany && <button type="button" disabled={busy} onClick={onChooseCompany} className="min-h-11 text-sm text-primary-700 underline">Към избора на фирма</button>}
      {!confirmedApplication && <><PreparationProgress step={1} /><div className="space-y-2"><h2 className="text-xl font-semibold text-foreground-950">Започни с твоите данни</h2><p className="text-base leading-relaxed text-foreground-600">Провери името и телефона си, за да може фирмата да се свърже с теб.</p></div></>}
      {confirmedApplication ? <DriverOnboarding applicationId={confirmedApplication} onReviewed={() => { void onRefresh(); }} /> : <form aria-label="Данни на поканения шофьор" className="space-y-5" onSubmit={async e => {
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
        <label className="block text-sm font-semibold text-foreground-800">Име и фамилия<input name="name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={[user?.first_name, user?.last_name].filter(Boolean).join(' ')} disabled={busy} className="block w-full mt-2 p-3 text-base font-normal border border-background-200 rounded-xl" /></label>
        <label className="block text-sm font-semibold text-foreground-800">Телефон<input name="phone" type="tel" required minLength={6} maxLength={30} autoComplete="tel" defaultValue={user?.phone ?? ''} disabled={busy} className="block w-full mt-2 p-3 text-base font-normal border border-background-200 rounded-xl" /></label>
        <label className="block text-sm font-semibold text-foreground-800">Опит като шофьор<select name="experience" required disabled={busy} className="block w-full mt-2 p-3 text-base font-normal border border-background-200 rounded-xl"><option value="">Избери</option>{['1–3', '3–5', '5–10', '10+'].map(v => <option key={v} value={v}>{v} години</option>)}</select></label>
        <label className="block text-sm font-semibold text-foreground-800">С кой автомобил ще работиш?<select name="vehicle" value={ownVehicle ? 'own' : 'company'} onChange={e => setOwnVehicle(e.target.value === 'own')} disabled={busy} className="block w-full mt-2 p-3 text-base font-normal border border-background-200 rounded-xl"><option value="company">Фирмен автомобил</option><option value="own">Мой автомобил</option></select></label>
        <p className="text-sm leading-relaxed text-foreground-600">{ownVehicle ? 'След обучението ще добавиш данните на колата, книжката, застраховката и регистрацията.' : 'Фирмата ще ти назначи автомобил. От теб ще е нужна само книжката.'}</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button aria-label={busy ? 'Запазваме…' : 'Запази и продължи към обучението'} disabled={busy} className="w-full bg-primary-500 text-white rounded-xl p-4 text-base font-semibold disabled:opacity-60">{busy ? 'Запазваме…' : 'Запази и продължи'}</button>
      </form>}
    </section>
  </div></main>;
}
