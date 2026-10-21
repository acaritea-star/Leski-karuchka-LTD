import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { applicationDocumentLabels, onboardingOptions, type ApplicationDocument, type Onboarding } from '@/lib/driverOnboarding';
import { supabase } from '@/lib/supabase';
import { signedDocumentUrl, workflowError } from '@/lib/driverDocuments';
import { documentExpired } from '@/lib/legalWorkflow';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { queryKeys } from '@/lib/queryKeys';
import ApplicationDocumentCard from '@/components/feature/ApplicationDocumentCard';

const fileKey = (doc: ApplicationDocument) => JSON.stringify([doc.id, doc.file_url, doc.expires_at]);
const validDate = (date: string | null | undefined) => !!date && !documentExpired(date);

function ReviewForm({ bundle, refresh, refreshing, onComplete }: { bundle: Onboarding; refresh: () => Promise<unknown>; refreshing: boolean; onComplete: () => void }) {
  const a = bundle.application;
  const client = useQueryClient();
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [category, setCategory] = useState(''), [vehicle, setVehicle] = useState(''), [note, setNote] = useState('');
  const [opened, setOpened] = useState<string[]>([]), [opening, setOpening] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const latch = useRef(false);
  const options = useQuery({ queryKey: ['application-vehicle-options', a.company_id], staleTime: 15_000, queryFn: async ({ signal }) => {
    const [cars, drivers, categories, companies] = await Promise.all([
      withRequestTimeout(abort => supabase.from('vehicles').select('*').eq('company_id', a.company_id).eq('is_active', true).order('registration_number').abortSignal(abort), 10_000, signal),
      withRequestTimeout(abort => supabase.from('drivers').select('vehicle_id').eq('company_id', a.company_id).abortSignal(abort), 10_000, signal),
      withRequestTimeout(abort => supabase.from('vehicle_types').select('id,name').eq('company_id', a.company_id).eq('is_active', true).order('name').abortSignal(abort), 10_000, signal),
      withRequestTimeout(abort => supabase.from('companies').select('id,is_active,permit_expires_on').eq('id', a.company_id).abortSignal(abort), 10_000, signal),
    ]);
    for (const result of [cars, drivers, categories, companies]) if (result.error) throw result.error;
    const assigned = new Set(drivers.data?.map(d => d.vehicle_id));
    return { vehicles: (cars.data ?? []).filter(c => !assigned.has(c.id)), categories: categories.data ?? [], company: companies.data?.find(c => c.id === a.company_id) };
  }});
  const chosenCategory = category || (options.data?.categories.length === 1 ? options.data.categories[0].id : '');
  const chosenVehicle = options.data?.vehicles.find(c => c.id === vehicle);
  const details = a.vehicle_details as Record<string, string> | null;
  const checked = confirmedRevision === a.onboarding_revision;
  const allOpened = bundle.documents.length > 0 && bundle.documents.every(x => opened.includes(fileKey(x)));
  const reviewed = bundle.documents.filter(x => opened.includes(fileKey(x))).length;
  const required = a.has_vehicle ? ['license', 'insurance', 'vehicle_registration'] as const : ['license', 'insurance'] as const;
  const remaining: string[] = [];
  if (!bundle.preparation.receipt) remaining.push('Кандидатът трябва да завърши подготовката и да приеме условията.');
  for (const type of required) {
    const doc = bundle.documents.find(x => x.type === type);
    if (!doc) remaining.push('Липсва: ' + applicationDocumentLabels[type] + '.');
    else if (type !== 'vehicle_registration' && !validDate(doc.expires_at)) remaining.push(applicationDocumentLabels[type] + ': необходим е валиден срок.');
  }
  if (options.isPending) remaining.push('Зареждаме автомобилите и фирмените изисквания…');
  else if (options.isError) remaining.push('Обновете автомобилите и фирмените изисквания.');
  else {
    if (!options.data?.company?.is_active) remaining.push('Фирмата трябва да е активна.');
    if (!validDate(options.data?.company?.permit_expires_on)) remaining.push('Попълнете валидния срок на разрешението в „Настройки“.');
    if (a.has_vehicle) {
      if (!options.data?.categories.some(c => c.id === chosenCategory)) remaining.push('Изберете категория на автомобила.');
      if (!details || !validDate(details.insurance_expiry_date) || !validDate(details.inspection_expiry_date)) remaining.push('Кандидатът трябва да обнови данните и сроковете на собствения автомобил.');
      const insurance = bundle.documents.find(x => x.type === 'insurance');
      if (insurance && insurance.expires_at !== details?.insurance_expiry_date) remaining.push('Срокът на застраховката в документа и собствения автомобил трябва да съвпада.');
    } else if (!chosenVehicle) remaining.push('Изберете свободен фирмен автомобил.');
    else {
      if (!validDate(chosenVehicle.insurance_expiry_date) || !validDate(chosenVehicle.inspection_expiry_date)
        || !options.data?.categories.some(c => c.id === chosenVehicle.vehicle_type_id)) remaining.push('Избраният автомобил трябва да има валидна застраховка, преглед и активна категория.');
      const insurance = bundle.documents.find(x => x.type === 'insurance');
      if (insurance && insurance.expires_at !== chosenVehicle.insurance_expiry_date) remaining.push('Срокът на качената застраховка трябва да съвпада с този на избрания автомобил.');
    }
  }
  if (!allOpened) remaining.push('Прегледайте всички качени документи (' + reviewed + ' от ' + bundle.documents.length + ').');
  if (!checked) remaining.push('Потвърдете проверката с отметката по-долу.');

  async function open(doc: ApplicationDocument) {
    if (opening) return;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setOpening(doc.id); setError('');
    try {
      if (!tab) throw new Error('Разрешете отварянето на документите в нов раздел и натиснете „Прегледай“ отново.');
      tab.location.replace(await signedDocumentUrl(doc.file_url));
      setOpened(old => old.includes(fileKey(doc)) ? old : [...old, fileKey(doc)]);
    } catch (e) { tab?.close(); setError(workflowError(e, 'Документът не е отворен.')); }
    finally { setOpening(null); }
  }
  async function verify() {
    if (latch.current || remaining.length || uploading || refreshing || options.isFetching || !!opening) return;
    latch.current = true; setBusy(true); setError('');
    try {
      const { data, error } = await withRequestTimeout(signal => supabase.rpc('verify_driver_application', {
        p_application: a.id, p_revision: a.onboarding_revision, p_vehicle: a.has_vehicle ? null : vehicle,
        p_category: a.has_vehicle ? chosenCategory : null, p_checks_confirmed: checked, p_note: note,
      }).abortSignal(signal));
      if (error) throw error;
      if (typeof data !== 'string' || !/^[0-9a-f-]{36}$/i.test(data)) throw new Error('Одобрението не е потвърдено. Обновете пакета.');
      onComplete();
    } catch (e) {
      setConfirmedRevision(null);
      setError(workflowError(e, 'Одобрението не е потвърдено. Обновете пакета преди повторен опит.'));
      await refresh();
      // Vehicle allocation may have changed in another administrator's tab.
      void options.refetch();
    } finally {
      latch.current = false; setBusy(false);
      void client.invalidateQueries({ queryKey: ['admin-driver-applications'] });
      void client.invalidateQueries({ queryKey: queryKeys.adminDrivers(a.company_id) });
      void client.invalidateQueries({ queryKey: queryKeys.adminVehicles(a.company_id) });
    }
  }
  return <section aria-label="Верификация на кандидат" className="space-y-5 rounded-2xl border border-primary-200 bg-white p-4 sm:p-5">
    <div><h3 className="text-lg font-semibold">Общ преглед: {a.full_name}</h3><p className="mt-1 text-sm text-foreground-600">Три стъпки: документи, автомобил и едно общо одобрение.</p><button type="button" disabled={busy || uploading || refreshing} onClick={() => void refresh()} className="min-h-11 text-sm underline text-primary-700 disabled:opacity-50">{refreshing ? 'Обновяваме пакета…' : 'Обнови пакета'}</button></div>
    <section aria-label="Преглед на документите" className="space-y-3">
      <h4 className="font-semibold">1. Прегледайте документите</h4>
      <p role="status" className="text-sm text-foreground-600">Прегледани документи: {reviewed} от {bundle.documents.length}</p>
      {bundle.documents.map(doc => <div key={doc.id} className="rounded-xl bg-background-50 p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="min-w-0 flex-1">{applicationDocumentLabels[doc.type]}{doc.expires_at ? ' · до ' + doc.expires_at : ''}<span className="block mt-1 text-xs text-foreground-600">{opened.includes(fileKey(doc)) ? '✓ Прегледан' : 'Предстои преглед'}</span></span>
        <button className="min-h-11 rounded-lg border border-background-200 bg-white px-3 text-primary-700 disabled:opacity-50" type="button" disabled={!!opening || busy} onClick={() => void open(doc)}>{opening === doc.id ? 'Отваряме…' : opened.includes(fileKey(doc)) ? 'Отвори отново' : 'Прегледай'}</button>
      </div>)}
      <p className="text-xs text-foreground-500">Файловете се отварят в отделен раздел. Върнете се тук след прегледа.</p>
    </section>
    <section aria-label="Автомобил за кандидата" className="space-y-3">
      <h4 className="font-semibold">2. Потвърдете автомобила</h4>
      {a.has_vehicle ? <>
        <p className="text-sm">Собствен автомобил: {details?.make} {details?.model} · {details?.registration_number}</p>
        <p className="text-xs text-foreground-600">Застраховка до {details?.insurance_expiry_date} · Преглед до {details?.inspection_expiry_date}</p>
        <label className="block text-sm">Категория<select disabled={options.isPending || busy} value={chosenCategory} onChange={e => { setCategory(e.target.value); setConfirmedRevision(null); }} className="block w-full rounded-xl border border-background-200 p-3 mt-1"><option value="">Изберете категория</option>{options.data?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </> : <>
        <label className="block text-sm">Назначете свободен фирмен автомобил<select value={vehicle} disabled={options.isPending || busy || uploading} onChange={e => { setVehicle(e.target.value); setConfirmedRevision(null); }} className="block w-full rounded-xl border border-background-200 p-3 mt-1"><option value="">Изберете автомобил</option>{options.data?.vehicles.map(c => <option key={c.id} value={c.id}>{c.registration_number} · {c.make} {c.model}</option>)}</select></label>
        {options.isSuccess && !options.data.vehicles.length && <p className="text-sm text-amber-800">Няма свободен активен автомобил. <Link to="/admin/vehicles" className="underline">Добавете или освободете автомобил</Link>, после обновете проверката.</p>}
        {chosenVehicle && <p className="text-xs text-foreground-600">За {chosenVehicle.registration_number}: застраховка до {chosenVehicle.insurance_expiry_date || 'не е въведена'} · преглед до {chosenVehicle.inspection_expiry_date || 'не е въведен'}.</p>}
        {chosenVehicle && <fieldset disabled={busy} className="min-w-0"><ApplicationDocumentCard key={chosenVehicle.id} bundle={bundle} type="insurance" defaultExpiry={chosenVehicle.insurance_expiry_date ?? ''} onSaved={refresh} onBusyChange={setUploading} /></fieldset>}
        <p className="text-xs text-foreground-600">Качете застраховката на избрания автомобил със същия срок като в „Автомобили“. Изборът и прегледаните непроменени документи се запазват след качването.</p>
      </>}
      <button type="button" disabled={options.isFetching || busy} onClick={() => void options.refetch()} className="min-h-11 text-sm underline text-primary-700 disabled:opacity-50">{options.isFetching ? 'Обновяваме…' : 'Обнови автомобилите и изискванията'}</button>
    </section>
    <section aria-label="Потвърждение на проверката" className="space-y-3">
      <h4 className="font-semibold">3. Потвърдете и верифицирайте</h4>
      <p className="text-sm text-foreground-600">{bundle.preparation.receipt ? '✓ Условията са приети лично и подготовката е завършена.' : 'Подготовката още не е завършена.'}</p>
      <label className="flex items-start gap-3 rounded-xl bg-background-50 p-3 text-sm leading-relaxed"><input type="checkbox" checked={checked} disabled={busy || !allOpened} onChange={e => setConfirmedRevision(e.target.checked ? a.onboarding_revision : null)} className="mt-1 h-5 w-5 shrink-0 accent-primary-500" />Проверих документите и разрешенията за работа на този шофьор и автомобил.</label>
      <p className="text-xs leading-relaxed text-foreground-600">Проверката включва четливост, самоличност, валидност, удостоверение за таксиметров водач, психологическа годност и приложимите фирмени и общински разрешения.</p>
      <label className="block text-sm">Бележка за проверката (по избор)<textarea maxLength={500} value={note} disabled={busy} onChange={e => setNote(e.target.value)} className="block w-full border border-background-200 rounded-xl p-3 mt-1" /></label>
    </section>
    <div className="space-y-3 rounded-xl border border-background-200 bg-white p-3">
      {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
      {remaining.length ? <div aria-label="Остава за верификация" className="text-sm"><p className="font-semibold">За да активирате бутона:</p><ul className="mt-2 list-disc pl-5 space-y-1 text-foreground-600">{remaining.map(reason => <li key={reason}>{reason}</li>)}</ul></div> : <p role="status" className="text-sm font-medium text-primary-700">Всичко е готово за верификация.</p>}
      <button type="button" disabled={busy || uploading || refreshing || !!remaining.length || options.isFetching || !!opening} onClick={() => void verify()} className="min-h-12 w-full py-3 rounded-xl bg-primary-500 text-white font-semibold disabled:bg-background-200 disabled:text-foreground-500 disabled:cursor-not-allowed">{busy ? 'Потвърждаваме…' : uploading ? 'Изчакваме документа…' : refreshing ? 'Обновяваме пакета…' : 'Одобри и верифицирай наведнъж'}</button>
      <p className="text-xs text-foreground-500">Одобрението записва документите и автомобила заедно. Шофьорът сам включва „Онлайн“, когато е готов.</p>
    </div>
  </section>;
}
export default function ApplicationReview({ applicationId, onComplete }: { applicationId: string; onComplete: () => void }) {
  const query = useQuery(onboardingOptions(applicationId));
  if (query.isPending) return <p role="status">Зареждане на целия пакет…</p>;
  if (query.isError || !query.data) return <p role="alert">Пакетът не е зареден. <button className="underline" onClick={() => void query.refetch()}>Опитай отново</button></p>;
  if (query.data.application.status === 'approved') return <p role="status">Одобрението е записано. Шофьорът е добавен.</p>;
  if (query.data.application.status !== 'pending' || !query.data.application.submitted_at) return <p role="status">Пакетът е променен или още не е изпратен. Изчакайте кандидатът да го подготви.</p>;
  // Preserve vehicle/note and reviews of immutable, unchanged files across uploads.
  // The final confirmation is tied to the current revision, so changed packages
  // still require a fresh explicit confirmation and server-side revision check.
  return <ReviewForm key={applicationId} bundle={query.data} refresh={() => query.refetch()} refreshing={query.isFetching} onComplete={onComplete} />;
}
