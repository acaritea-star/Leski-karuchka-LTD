import { useSearchParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { queryKeys } from '@/lib/queryKeys';
import { workflowError } from '@/lib/driverDocuments';
import type { Tables } from '@/lib/database.types';
import ApplicationReview from './ApplicationReview';
import PartnerInvitations from '@/components/feature/PartnerInvitations';

export default function DriverApplications({ companyId }: { companyId: string }) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const requested = params.get('application');
  const target = requested && /^[0-9a-f-]{36}$/i.test(requested) ? requested : null;
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const latch = useRef(false);
  const key = ['admin-driver-applications', user?.id, companyId, target];
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => {
        let read = supabase.from('driver_applications').select('*').eq('company_id', companyId).eq('status', 'pending');
        if (target) read = read.eq('id', target);
        return read.order('submitted_at', { ascending: true, nullsFirst: false }).order('created_at').limit(100).abortSignal(abort);
      }, 10_000, signal);
      if (error) throw error;
      return data ?? [];
    },
  });
  const reviewedTarget = useRef('');
  useEffect(() => {
    const application = query.data?.find(a => a.id === target);
    if (application?.onboarding_required && application.submitted_at && reviewedTarget.current !== application.id) {
      reviewedTarget.current = application.id; setReviewId(application.id);
    }
  }, [query.data, target]);
  async function review(application: Tables<'driver_applications'>, decision: 'approved' | 'rejected') {
    if (latch.current) return;
    latch.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const { data, error } = await withRequestTimeout(signal => supabase.rpc('review_driver_application', {
        p_id: application.id, p_decision: decision, p_note: notes[application.id] ?? '',
      }).abortSignal(signal));
      if (error) throw error;
      if (data !== application.id) throw new Error('Решението не е потвърдено. Обновете списъка.');
      setNotice(decision === 'approved' ? 'Шофьорът е добавен, но още не е верифициран. Следват документи, автомобил и верификация.' : 'Кандидатурата е отхвърлена.');
    } catch (error) { setError(workflowError(error, 'Не успяхме да потвърдим решението. Обновете списъка преди повторен опит.')); }
    finally {
      latch.current = false; setBusy(false);
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: queryKeys.adminDrivers(companyId) });
      void client.invalidateQueries({ queryKey: queryKeys.adminVehicles(companyId) });
    }
  }
  return <div className="space-y-4 text-sm">
    <PartnerInvitations key={companyId} kind="driver" companyId={companyId} />
    <p className="text-foreground-500">При готов пакет използвайте „Прегледай целия пакет“ и едно общо одобрение.</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {notice && <p role="status" className="text-accent-700">{notice}</p>}
    <button disabled={busy || query.isFetching} onClick={() => void query.refetch()} className="underline text-primary-700">Обнови кандидатурите</button>
    {query.isPending ? <p role="status">Зареждане…</p> : query.isError ? <p role="alert">Кандидатурите не са заредени. Опитайте отново.</p> : !query.data?.length ? <p>Няма чакащи кандидатури за тази фирма.</p> : query.data.map(application => <div key={application.id} className="border border-background-200 rounded-xl p-4 space-y-2">
      <p className="font-semibold">{application.full_name}</p><p>{application.phone} · {application.email || 'Без предоставен имейл'}</p>
      <p className="text-foreground-500">Опит: {application.experience} години · Собствен автомобил: {application.has_vehicle ? 'да' : 'не'}</p>
      {application.message && <p className="break-words">{application.message}</p>}
      <label className="block text-xs">Бележка до кандидата (за връщане: посочете какво да поправи)<textarea maxLength={500} value={notes[application.id] ?? ''} disabled={busy} onChange={e => setNotes(old => ({ ...old, [application.id]: e.target.value }))} className="w-full rounded-lg border border-background-200 p-2 mt-1" /></label>
      {application.onboarding_required && <p className="text-xs text-foreground-500">{application.submitted_at ? 'Пакетът е изпратен за общ преглед.' : 'Кандидатът още подготвя условията и документите.'}</p>}
      <div className="flex gap-2">{application.onboarding_required ? <button disabled={busy || !application.submitted_at} onClick={() => setReviewId(reviewId === application.id ? null : application.id)} className="flex-1 py-2 bg-primary-500 text-white rounded-lg disabled:opacity-50">Прегледай целия пакет</button> : <button disabled={busy} onClick={() => void review(application, 'approved')} className="flex-1 py-2 bg-primary-500 text-white rounded-lg disabled:opacity-50">Одобри по-ранна кандидатура</button>}<button disabled={busy} onClick={() => void review(application, 'rejected')} className="flex-1 py-2 bg-red-50 text-red-600 rounded-lg disabled:opacity-50">Върни за корекция</button></div>
      {reviewId === application.id && <ApplicationReview applicationId={application.id} onComplete={() => { setNotice('Документите, автомобилът и шофьорът са одобрени заедно. Профилът е готов за работа.'); setReviewId(null); void query.refetch(); }} />}
    </div>)}
    {query.data?.length === 100 && <p>Показани са първите 100 кандидатури. След разглеждане ще се заредят следващите.</p>}
  </div>;
}
