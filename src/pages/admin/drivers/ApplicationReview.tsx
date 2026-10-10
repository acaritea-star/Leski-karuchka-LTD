import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { applicationDocumentLabels, onboardingOptions, type Onboarding } from '@/lib/driverOnboarding';
import { supabase } from '@/lib/supabase';
import { signedDocumentUrl, workflowError } from '@/lib/driverDocuments';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { queryKeys } from '@/lib/queryKeys';
import ApplicationDocumentCard from '@/components/feature/ApplicationDocumentCard';

function ReviewForm({ bundle, refresh, onComplete }: { bundle: Onboarding; refresh: () => Promise<unknown>; onComplete: () => void }) {
  const a = bundle.application;
  const client = useQueryClient();
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [category, setCategory] = useState(''), [vehicle, setVehicle] = useState(''), [note, setNote] = useState('');
  const [opened, setOpened] = useState<string[]>([]);
  const latch = useRef(false);
  const options = useQuery({ queryKey: ['application-vehicle-options', a.company_id], staleTime: 15_000, queryFn: async ({ signal }) => {
    const [cars, drivers, categories] = await Promise.all([
      withRequestTimeout(abort => supabase.from('vehicles').select('*').eq('company_id', a.company_id).eq('is_active', true).order('registration_number').abortSignal(abort), 10_000, signal),
      withRequestTimeout(abort => supabase.from('drivers').select('vehicle_id').eq('company_id', a.company_id).abortSignal(abort), 10_000, signal),
      withRequestTimeout(abort => supabase.from('vehicle_types').select('id,name').eq('company_id', a.company_id).eq('is_active', true).order('name').abortSignal(abort), 10_000, signal),
    ]);
    for (const result of [cars, drivers, categories]) if (result.error) throw result.error;
    const assigned = new Set(drivers.data?.map(d => d.vehicle_id));
    return { vehicles: (cars.data ?? []).filter(c => !assigned.has(c.id)), categories: categories.data ?? [] };
  }});
  const chosenCategory = category || (options.data?.categories.length === 1 ? options.data.categories[0].id : '');
  const details = a.vehicle_details as Record<string, string> | null;
  const allOpened = bundle.documents.every(x => opened.includes(x.id));
  async function open(fileUrl: string, id: string) {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      if (!tab) throw new Error('Разрешете отварянето на документите в нов раздел.');
      tab.location.href = await signedDocumentUrl(fileUrl); setOpened(old => old.includes(id) ? old : [...old, id]);
    } catch (e) { tab?.close(); setError(workflowError(e, 'Документът не е отворен.')); }
  }
  return <div className="space-y-3">
    <h3 className="font-semibold">Общ преглед: {a.full_name}</h3>
    <p className="text-sm">{bundle.preparation.receipt ? '✓ Условията са приети лично и подготовката е завършена.' : 'Подготовката още не е завършена.'}</p>
    {bundle.documents.map(x => <div key={x.id} className="rounded-xl bg-background-50 p-3 flex flex-wrap justify-between gap-2 text-sm">
      <span>{applicationDocumentLabels[x.type]}{x.expires_at ? ' · до ' + x.expires_at : ''}</span><button className="underline text-primary-700" type="button" onClick={() => void open(x.file_url, x.id)}>Прегледай{opened.includes(x.id) ? ' ✓' : ''}</button>
    </div>)}
    {a.has_vehicle ? <>
      <p className="text-sm">Собствен автомобил: {details?.make} {details?.model} · {details?.registration_number}</p>
      <p className="text-xs">Застраховка до {details?.insurance_expiry_date} · Преглед до {details?.inspection_expiry_date}</p>
      <label className="block text-xs">Категория<select disabled={options.isPending || busy} value={chosenCategory} onChange={e => setCategory(e.target.value)} className="block w-full rounded-lg border border-background-200 p-2 mt-1"><option value="">Изберете категория</option>{options.data?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    </> : <>
      <label className="block text-xs">Назначете свободен фирмен автомобил<select value={vehicle} disabled={options.isPending || busy} onChange={e => setVehicle(e.target.value)} className="block w-full rounded-lg border border-background-200 p-2 mt-1"><option value="">Изберете автомобил</option>{options.data?.vehicles.map(c => <option key={c.id} value={c.id}>{c.registration_number} · {c.make} {c.model}</option>)}</select></label>
      <ApplicationDocumentCard bundle={bundle} type="insurance" onSaved={refresh} />
      <p className="text-xs text-foreground-500">Качете застраховката на избрания автомобил. Срокът трябва да съвпада със записания в „Автомобили“.</p>
    </>}
    {options.isError && <p role="alert" className="text-red-600 text-sm">Автомобилите и категориите не са заредени. <button className="underline" onClick={() => void options.refetch()}>Опитай отново</button></p>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} disabled={busy || !allOpened} onChange={e => setChecked(e.target.checked)} className="mt-1 accent-primary-500" />Проверих четливостта, самоличността, съответствието с автомобила и валидността на документите, удостоверението за таксиметров водач, психологическата годност и приложимите фирмени и общински разрешения.</label>
    {!allOpened && <p className="text-xs text-foreground-500">Отворете всички качени документи преди потвърждението.</p>}
    <label className="block text-xs">Бележка за проверката (по избор)<textarea maxLength={500} value={note} disabled={busy} onChange={e => setNote(e.target.value)} className="block w-full border border-background-200 rounded-lg p-2 mt-1" /></label>
    {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
    <button type="button" disabled={busy || !checked || !allOpened || !bundle.preparation.receipt || options.isPending || options.isError || (a.has_vehicle ? !chosenCategory : !vehicle || !bundle.documents.some(x => x.type === 'insurance'))} onClick={async () => {
      if (latch.current) return; latch.current = true; setBusy(true); setError('');
      try {
        const { data, error } = await withRequestTimeout(signal => supabase.rpc('verify_driver_application', {
          p_application: a.id, p_revision: a.onboarding_revision, p_vehicle: a.has_vehicle ? null : vehicle, p_category: a.has_vehicle ? chosenCategory : null, p_checks_confirmed: checked, p_note: note,
        }).abortSignal(signal));
        if (error) throw error;
        if (typeof data !== 'string' || !/^[0-9a-f-]{36}$/i.test(data)) throw new Error('Одобрението не е потвърдено. Обновете пакета.');
        onComplete();
      } catch (e) {
        setError(workflowError(e, 'Одобрението не е потвърдено. Обновете пакета преди повторен опит.'));
        // A committed transaction with a lost response is recovered by the authoritative application status.
        await refresh();
      } finally {
        latch.current = false; setBusy(false);
        void client.invalidateQueries({ queryKey: ['admin-driver-applications'] });
        void client.invalidateQueries({ queryKey: queryKeys.adminDrivers(a.company_id) });
        void client.invalidateQueries({ queryKey: queryKeys.adminVehicles(a.company_id) });
      }
    }} className="w-full py-3 rounded-xl bg-primary-500 text-white font-semibold disabled:opacity-50">{busy ? 'Потвърждаваме…' : 'Одобри и верифицирай наведнъж'}</button>
    <p className="text-xs text-foreground-500">Успешното одобрение записва документите, подготовката и назначението заедно. Шофьорът остава офлайн и сам включва „Онлайн“, когато е готов.</p>
  </div>;
}
export default function ApplicationReview({ applicationId, onComplete }: { applicationId: string; onComplete: () => void }) {
  const query = useQuery(onboardingOptions(applicationId));
  if (query.isPending) return <p role="status">Зареждане на целия пакет…</p>;
  if (query.isError || !query.data) return <p role="alert">Пакетът не е зареден. <button className="underline" onClick={() => void query.refetch()}>Опитай отново</button></p>;
  if (query.data.application.status === 'approved') return <p role="status">Одобрението е записано. Шофьорът е добавен.</p>;
  if (query.data.application.status !== 'pending' || !query.data.application.submitted_at) return <p role="status">Пакетът е променен или още не е изпратен. Изчакайте кандидатът да го подготви.</p>;
  return <ReviewForm key={applicationId + ':' + query.data.application.onboarding_revision} bundle={query.data} refresh={() => query.refetch()} onComplete={onComplete} />;
}
