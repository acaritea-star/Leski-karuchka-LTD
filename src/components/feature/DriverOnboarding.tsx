import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { acceptApplicationPreparation, onboardingOptions, saveApplicationVehicle, submitOnboarding, type Onboarding, type VehicleDetails } from '@/lib/driverOnboarding';
import { documentExpired } from '@/lib/legalWorkflow';
import { workflowError } from '@/lib/driverDocuments';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import DriverPreparationForm from './DriverPreparationForm';
import ApplicationDocumentCard from './ApplicationDocumentCard';
import PreparationProgress from './PreparationProgress';

function taskKey(bundle?: Onboarding) {
  if (!bundle) return '';
  const a = bundle.application;
  if (a.status === 'approved' || a.status === 'rejected') return a.status;
  if (a.submitted_at) return 'waiting';
  if (!bundle.preparation.receipt) return 'training';
  if (a.has_vehicle && !a.vehicle_details) return 'vehicle';
  const required = a.has_vehicle ? ['license', 'insurance', 'vehicle_registration'] : ['license'];
  return required.find(type => !bundle.documents.some(x => x.type === type && (type === 'vehicle_registration' || !documentExpired(x.expires_at)))) || 'ready';
}

function VehicleForm({ application: a, onSaved }: { application: Onboarding['application']; onSaved: () => Promise<unknown> }) {
  const [hasVehicle, setHasVehicle] = useState(a.has_vehicle);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latch = useRef(false);
  const details = a.vehicle_details as VehicleDetails | null;
  return <form aria-label="Автомобил за верификация" className="space-y-4" onSubmit={async e => {
    e.preventDefault(); if (latch.current) return;
    const form = new FormData(e.currentTarget);
    latch.current = true; setBusy(true); setError('');
    try {
      const data = hasVehicle ? Object.fromEntries(['make', 'model', 'registration_number', 'insurance_expiry_date', 'inspection_expiry_date'].map(k => [k, String(form.get(k) ?? '').trim()])) as VehicleDetails : null;
      await saveApplicationVehicle(a, hasVehicle, data);
    } catch (e) { setError(workflowError(e, 'Данните не са потвърдени. Обнови статуса.')); }
    finally { await onSaved(); latch.current = false; setBusy(false); }
  }}>
    <label className="block text-sm font-semibold">С кой автомобил ще работиш?<select value={hasVehicle ? 'own' : 'company'} disabled={busy} onChange={e => setHasVehicle(e.target.value === 'own')} className="block w-full rounded-lg border border-background-200 p-3 mt-2 text-base font-normal">
      <option value="company">Фирмен автомобил</option><option value="own">Мой автомобил</option>
    </select></label>
    {hasVehicle ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{([
      ['make', 'Марка', 'text'], ['model', 'Модел', 'text'], ['registration_number', 'Регистрационен номер', 'text'],
      ['insurance_expiry_date', 'Застраховка до', 'date'], ['inspection_expiry_date', 'Технически преглед до', 'date'],
    ] as const).map(([name, label, type]) => <label key={name} className="text-sm font-medium text-foreground-800">{label}<input name={name} type={type} required defaultValue={details?.[name] ?? ''} maxLength={name === 'registration_number' ? 30 : 80} disabled={busy} className="block w-full rounded-lg border border-background-200 p-3 mt-2 text-base font-normal" /></label>)}</div>
      : <p className="text-sm text-foreground-600">Качи своята книжка. Фирмата назначава автомобил и добавя неговата застраховка при общия преглед.</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <button type="submit" disabled={busy} className="w-full rounded-xl bg-primary-500 p-4 text-base font-semibold text-white disabled:opacity-50">{busy ? 'Запазване…' : 'Запази избора и данните'}</button>
  </form>;
}
export default function DriverOnboarding({ applicationId, onReviewed }: { applicationId: string; onReviewed: () => void }) {
  const { refreshProfile } = useAuth();
  const query = useQuery(onboardingOptions(applicationId));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latch = useRef(false);
  const refresh = () => query.refetch();
  const task = taskKey(query.data);
  const taskRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!task) return;
    taskRef.current?.focus({ preventScroll: true });
    taskRef.current?.scrollIntoView?.({ block: 'start' });
  }, [task]);
  if (query.isPending) return <p role="status" className="text-base py-5">Зареждаме подготовката…</p>;
  if (query.isError || !query.data) return <div role="alert" className="rounded-xl bg-background-50 p-5 space-y-3"><p className="text-base">Не успяхме да заредим подготовката. Провери връзката си и опитай отново.</p><button onClick={() => void refresh()} className="rounded-xl bg-primary-500 p-4 font-semibold text-white">Опитай отново</button></div>;
  const bundle = query.data, a = bundle.application, prepared = !!bundle.preparation.receipt;
  if (a.status === 'rejected') return <div className="rounded-2xl bg-background-50 p-5 space-y-4"><h2 className="text-2xl font-semibold">Има нещо за поправяне</h2><p className="text-base leading-relaxed">Фирмата прегледа документите. Следвай бележката по-долу и изпрати пакета отново.</p><p role="status" className="rounded-xl bg-white p-4 text-base leading-relaxed">{a.review_note || 'Свържи се с фирмата за уточнение какво трябва да поправиш.'}</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <button disabled={busy} onClick={async () => {
      if (latch.current) return; latch.current = true; setBusy(true); setError('');
      try { const { data, error } = await withRequestTimeout(signal => supabase.rpc('reopen_driver_onboarding', { p_application: a.id }).abortSignal(signal));
        if (error) throw error; if (data !== a.id) throw new Error('Корекцията не е потвърдена.'); await refresh(); onReviewed();
      } catch (e) { setError(workflowError(e, 'Обнови статуса преди повторен опит.')); } finally { await refresh(); onReviewed(); latch.current = false; setBusy(false); }
    }} className="w-full rounded-xl bg-primary-500 text-white p-4 font-semibold">{busy ? 'Отваряме пакета…' : 'Коригирай пакета'}</button><p className="text-sm leading-relaxed">Запазените условия и документи остават. Поправи необходимото и изпрати пакета отново.</p></div>;
  const required = (a.has_vehicle ? ['license', 'insurance', 'vehicle_registration'] : ['license']) as ('license' | 'insurance' | 'vehicle_registration')[];
  const valid = (type: string) => bundle.documents.some(x => x.type === type && (type === 'vehicle_registration' || !documentExpired(x.expires_at)));
  const vehicleReady = !a.has_vehicle || !!a.vehicle_details;
  const ready = prepared && vehicleReady && required.every(valid);
  const nextDocument = required.find(type => !valid(type));
  const completedDocuments = required.filter(valid);
  const step = a.status === 'approved' ? 5 : a.submitted_at ? 4 : prepared ? 3 : 2;
  const vehicle = <VehicleForm key={a.id + ':' + a.has_vehicle} application={a} onSaved={refresh} />;
  const documents = <section className="space-y-5">
    <div className="space-y-2"><h2 className="text-2xl font-semibold text-foreground-950">Документи и автомобил</h2><p className="text-base leading-relaxed text-foreground-600">{!vehicleReady ? 'Първо запази данните на автомобила. След това ще качим документите един по един.' : nextDocument ? 'Качи следващия документ. След запазването му ще покажем какво остава.' : 'Готово — необходимите документи са качени. Можеш да ги изпратиш на фирмата.'}</p></div>
    {vehicleReady ? <details className="rounded-xl border border-background-200 p-4"><summary className="text-base font-semibold cursor-pointer">{a.has_vehicle ? '✓ Данните на автомобила са запазени' : 'Автомобилът ще бъде осигурен от фирмата'} · промени</summary><div className="mt-4">{vehicle}</div></details> : vehicle}
    {vehicleReady && <>
      <p role="status" className="text-sm font-medium text-foreground-600">Качени валидни документи: {completedDocuments.length} от {required.length}</p>
      {nextDocument && <ApplicationDocumentCard key={a.id + ':' + a.company_id + ':' + nextDocument} bundle={bundle} type={nextDocument} onSaved={refresh} />}
      {!!completedDocuments.length && <details className="rounded-xl border border-background-200 p-4"><summary className="text-base font-semibold cursor-pointer">Вече качени документи ({completedDocuments.length})</summary><div className="mt-4 space-y-3">{completedDocuments.map(type => <ApplicationDocumentCard key={a.id + ':' + a.company_id + ':' + type} bundle={bundle} type={type} onSaved={refresh} />)}</div></details>}
    </>}
    {error && <p role="alert" className="text-base text-red-600">{error}</p>}
    {ready && !a.submitted_at && <div className="rounded-2xl border border-primary-200 bg-primary-50 p-5 space-y-3"><h3 className="text-xl font-semibold text-foreground-950">Изпрати за одобрение</h3><p className="text-base leading-relaxed text-foreground-600">Фирмата ще провери документите и автомобила заедно. След одобрението ще можеш да включиш онлайн.</p><button disabled={busy} onClick={async () => {
      if (latch.current) return; latch.current = true; setBusy(true); setError('');
      try { await submitOnboarding(a); } catch (e) { setError(workflowError(e, 'Изпращането не е потвърдено. Обнови статуса.')); }
      finally { await refresh(); latch.current = false; setBusy(false); }
    }} className="w-full rounded-xl bg-primary-500 p-4 text-white text-base font-semibold disabled:opacity-50">{busy ? 'Потвърждаваме…' : 'Изпрати целия пакет за проверка'}</button></div>}
    <details className="text-sm text-foreground-500"><summary className="cursor-pointer">Как се проверяват документите?</summary><p className="mt-3 leading-relaxed">Фирмата проверява и удостоверението за таксиметров водач, психологическата годност и приложимите разрешения. Верификацията в приложението не е разрешение за превоз.</p></details>
  </section>;
  return <div ref={taskRef} tabIndex={-1} aria-label="Текуща стъпка" className="space-y-6 scroll-mt-4 focus:outline-none">
    <PreparationProgress step={step} />
    {a.status === 'approved' ? <div className="rounded-2xl bg-primary-50 border border-primary-200 p-5 space-y-3"><h2 className="text-2xl font-semibold">Готов си за работа</h2><p role="status" className="text-base leading-relaxed">Фирмата одобри профила ти. Продължи към шофьорския панел.</p>{error && <p role="alert" className="text-base text-red-600">{error}</p>}<button disabled={busy} className="w-full rounded-xl bg-primary-500 text-white p-4 font-semibold disabled:opacity-50" onClick={async () => {
      if (latch.current) return; latch.current = true; setBusy(true); setError('');
      try { await refreshProfile(); onReviewed(); }
      catch (e) { setError(workflowError(e, 'Не успяхме да отворим панела. Провери връзката и опитай отново.')); }
      finally { latch.current = false; setBusy(false); }
    }}>{busy ? 'Отваряме панела…' : 'Към шофьорския панел'}</button></div> : a.submitted_at ? <>
      <div role="status" className="rounded-2xl bg-primary-50 border border-primary-200 p-5 space-y-3"><h2 className="text-2xl font-semibold">Всичко е изпратено</h2><p className="text-base leading-relaxed text-foreground-700">Пакетът е изпратен. Сега е ред на фирмата да го прегледа.</p><p className="text-base leading-relaxed text-foreground-600">Ще обновим статуса автоматично, докато страницата е отворена. Можеш и да я затвориш и да продължиш по-късно със същия профил.</p></div>
      <details className="rounded-xl border border-background-200 p-4"><summary className="text-base font-semibold cursor-pointer">Преглед и промяна на изпратеното</summary><p className="my-4 text-sm leading-relaxed text-foreground-600">Ако промениш документ или автомобила, ще трябва да изпратиш пакета отново за проверка.</p>{documents}</details>
    </> : <>
      {!prepared ? <><div className="space-y-2"><h2 className="text-2xl font-semibold text-foreground-950">Как работи приложението</h2><p className="text-base leading-relaxed text-foreground-600">Прочети кратките насоки. Можеш да се върнеш назад, когато пожелаеш. Накрая има три въпроса и условията за работа.</p></div><DriverPreparationForm key={bundle.preparation.content_hash} materials={bundle.preparation} acceptPreparation={async answers => { await acceptApplicationPreparation(bundle, answers); await refresh(); }} onUncertain={() => void refresh()} /></> : <>
        {documents}
        <details className="rounded-xl border border-background-200 p-4"><summary className="text-sm font-semibold cursor-pointer">✓ Обучението и условията са запазени</summary><div className="mt-3"><DriverPreparationForm materials={bundle.preparation} acceptPreparation={async () => {}} onUncertain={() => void refresh()} /></div></details>
      </>}
    </>}
    <button type="button" disabled={query.isFetching} onClick={() => { void refresh(); void refreshProfile(); }} className="min-h-12 text-base underline text-primary-700 disabled:opacity-50">{query.isFetching ? 'Проверяваме…' : 'Обнови статуса'}</button>
  </div>;
}
