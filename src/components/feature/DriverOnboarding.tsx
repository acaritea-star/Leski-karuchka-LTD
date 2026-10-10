import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { acceptApplicationPreparation, onboardingOptions, saveApplicationVehicle, submitOnboarding, type Onboarding, type VehicleDetails } from '@/lib/driverOnboarding';
import { documentExpired } from '@/lib/legalWorkflow';
import { workflowError } from '@/lib/driverDocuments';
import DriverPreparationForm from './DriverPreparationForm';
import ApplicationDocumentCard from './ApplicationDocumentCard';

function VehicleForm({ application: a, onSaved }: { application: Onboarding['application']; onSaved: () => Promise<unknown> }) {
  const [hasVehicle, setHasVehicle] = useState(a.has_vehicle);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latch = useRef(false);
  const details = a.vehicle_details as VehicleDetails | null;
  return <form aria-label="Автомобил за верификация" className="space-y-3" onSubmit={async e => {
    e.preventDefault(); if (latch.current) return;
    const form = new FormData(e.currentTarget);
    latch.current = true; setBusy(true); setError('');
    try {
      const data = hasVehicle ? Object.fromEntries(['make', 'model', 'registration_number', 'insurance_expiry_date', 'inspection_expiry_date'].map(k => [k, String(form.get(k) ?? '').trim()])) as VehicleDetails : null;
      await saveApplicationVehicle(a, hasVehicle, data);
    } catch (e) { setError(workflowError(e, 'Данните не са потвърдени. Обнови статуса.')); }
    finally { await onSaved(); latch.current = false; setBusy(false); }
  }}>
    <label className="block text-sm font-semibold">С кой автомобил ще работиш?<select value={hasVehicle ? 'own' : 'company'} disabled={busy} onChange={e => setHasVehicle(e.target.value === 'own')} className="block w-full rounded-lg border border-background-200 p-3 mt-1">
      <option value="company">Фирмата ще ми назначи автомобил</option><option value="own">Имам собствен автомобил</option>
    </select></label>
    {hasVehicle ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{([
      ['make', 'Марка', 'text'], ['model', 'Модел', 'text'], ['registration_number', 'Регистрационен номер', 'text'],
      ['insurance_expiry_date', 'Застраховка до', 'date'], ['inspection_expiry_date', 'Технически преглед до', 'date'],
    ] as const).map(([name, label, type]) => <label key={name} className="text-xs">{label}<input name={name} type={type} required defaultValue={details?.[name] ?? ''} maxLength={name === 'registration_number' ? 30 : 80} disabled={busy} className="block w-full rounded-lg border border-background-200 p-2 mt-1" /></label>)}</div>
      : <p className="text-sm text-foreground-600">Качи своята книжка. Фирмата назначава автомобил и добавя неговата застраховка при общия преглед.</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <button type="submit" disabled={busy} className="text-sm underline text-primary-700">{busy ? 'Запазване…' : 'Запази избора и данните'}</button>
  </form>;
}
export default function DriverOnboarding({ applicationId, onReviewed }: { applicationId: string; onReviewed: () => void }) {
  const { refreshProfile } = useAuth();
  const query = useQuery(onboardingOptions(applicationId));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latch = useRef(false);
  const refresh = () => query.refetch();
  if (query.isPending) return <p role="status">Зареждаме подготовката…</p>;
  if (query.isError || !query.data) return <div role="alert"><p>Пакетът не е зареден.</p><button onClick={() => void refresh()} className="underline">Опитай отново</button></div>;
  const bundle = query.data, a = bundle.application, prepared = !!bundle.preparation.receipt;
  if (a.status === 'rejected') return <div role="status"><p>Фирмата върна пакета за корекция. {a.review_note}</p><button onClick={onReviewed} className="underline text-primary-700">Коригирай кандидатурата</button></div>;
  const required = a.has_vehicle ? ['license', 'insurance', 'vehicle_registration'] : ['license'];
  const ready = prepared && (!a.has_vehicle || !!a.vehicle_details) && required.every(type => bundle.documents.some(x => x.type === type && (type === 'vehicle_registration' || !documentExpired(x.expires_at))));
  return <div className="space-y-4">
    <p className="font-semibold text-primary-700">Присъединяване към {bundle.company_name}</p>
    <ol className="space-y-1 text-sm" aria-label="Стъпки за присъединяване"><li>1. {prepared ? '✓ ' : ''}Права, задължения и подготовка</li><li>2. {ready ? '✓ ' : ''}Документи и автомобил</li><li>3. {a.submitted_at ? '✓ ' : ''}Общ преглед от фирмата</li></ol>
    {a.status === 'approved' ? <div role="status"><p>Фирмата одобри профила ти. Влез в шофьорската част.</p><button className="underline text-primary-700" onClick={() => void refreshProfile()}>Обнови профила</button></div> : <>
      {prepared ? <details className="rounded-xl border border-background-200 p-3"><summary className="text-sm font-semibold cursor-pointer">✓ Подготовката е завършена · условия и запис</summary><div className="mt-3"><DriverPreparationForm materials={bundle.preparation} acceptPreparation={async () => {}} onUncertain={() => void refresh()} /></div></details>
        : <DriverPreparationForm key={bundle.preparation.content_hash} materials={bundle.preparation} acceptPreparation={async answers => { await acceptApplicationPreparation(bundle, answers); await refresh(); }} onUncertain={() => void refresh()} />}
      {prepared && <section className="space-y-4">
        <h4 className="font-semibold">2. Документи и автомобил</h4>
        <VehicleForm key={a.id + ':' + a.has_vehicle} application={a} onSaved={refresh} />
        <p className="text-xs text-foreground-500">Четлив JPG, PNG, WebP или PDF до 5 MB. Документите са частни и достъпни за проверката от твоята фирма. Не качвай лична карта.</p>
        {(required as ('license' | 'insurance' | 'vehicle_registration')[]).map(type => <ApplicationDocumentCard key={a.id + ':' + a.company_id + ':' + type} bundle={bundle} type={type} onSaved={refresh} />)}
        <p className="text-xs text-foreground-500">Фирмата проверява и удостоверението за таксиметров водач, психологическата годност и приложимите разрешения. Верификацията в приложението не е разрешение за превоз.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {a.submitted_at ? <p role="status" className="rounded-xl bg-accent-50 p-4 text-sm text-accent-700">Пакетът е изпратен. Фирмата ще направи един общ преглед. Ако промениш документ или автомобила, изпрати го отново.</p> : <button disabled={!ready || busy} onClick={async () => {
          if (latch.current) return; latch.current = true; setBusy(true); setError('');
          try { await submitOnboarding(a); } catch (e) { setError(workflowError(e, 'Изпращането не е потвърдено. Обнови статуса.')); }
          finally { await refresh(); latch.current = false; setBusy(false); }
        }} className="w-full rounded-xl bg-primary-500 py-3 text-white font-semibold disabled:opacity-50">{busy ? 'Потвърждаваме…' : 'Изпрати целия пакет за проверка'}</button>}
      </section>}
    </>}
    <button type="button" disabled={query.isFetching} onClick={() => { void refresh(); void refreshProfile(); }} className="text-sm underline text-primary-700">Обнови статуса</button>
  </div>;
}
