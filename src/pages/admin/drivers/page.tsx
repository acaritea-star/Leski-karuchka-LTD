import { Link, useSearchParams } from 'react-router-dom';
import Modal from '@/components/feature/Modal';
import DriverVerificationStatus from '@/components/feature/DriverVerificationStatus';
import { driverVerificationOptions, verificationKey } from '@/lib/driverVerification';
import DriverApplications from './DriverApplications';
import { signedDocumentUrl, workflowError } from '@/lib/driverDocuments';
import { useState, useRef, useEffect } from 'react';
import { useFleetClock } from '@/hooks/useFleetClock';
import { loadAdminDrivers, adminDriverOnline, ADMIN_PAGE_SIZE, type AdminDriver } from '@/lib/adminData';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import type { Tables } from '@/lib/database.types';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import { useAuth } from '@/hooks/useAuth';
import { documentExpired } from '@/lib/legalWorkflow';
import { withRequestTimeout } from '@/lib/requestTimeout';

type DriverWithName = AdminDriver;
type DocumentRow = Tables<'driver_documents'>;

const DOC_LABELS: Record<string, string> = {
  license: 'Шофьорска книжка',
  id_card: 'Лична карта',
  insurance: 'Застраховка',
  vehicle_registration: 'Регистрация на автомобила',
};

function VerificationAction({ driver, busy, pendingEdits, onVerify }: { driver: DriverWithName; busy: boolean; pendingEdits: boolean; onVerify: (driver: DriverWithName) => void }) {
  const query = useQuery(driverVerificationOptions(driver.id));
  const report = query.data;
  const verified = report?.is_verified ?? driver.is_verified;
  if (verified) return <p role="status" className="mt-4 text-sm text-primary-700">✓ Шофьорът е верифициран.</p>;
  return <div className="mt-4 rounded-xl border border-background-200 bg-white p-3 space-y-3">
    {report?.blockers.some(x => ['vehicle', 'vehicle_insurance', 'vehicle_inspection'].includes(x.code)) && <Link to="/admin/vehicles" className="block min-h-11 text-sm underline text-primary-700">Избери или обнови автомобил в „Автомобили“</Link>}
    {report?.blockers.some(x => x.code === 'company_permit') && <Link to="/admin/settings" className="block min-h-11 text-sm underline text-primary-700">Обнови разрешението на фирмата в „Настройки“</Link>}
    <p className="text-sm text-foreground-600">{pendingEdits ? 'Запазете променените срокове с „Одобри“, преди да верифицирате.' : query.isError ? 'Обновете проверката по-горе, преди да верифицирате.' : report?.can_verify ? 'Всичко е готово. Потвърдете верификацията тук.' : 'Изпълнете оставащите условия, показани по-горе. След одобрение на документите проверката се обновява автоматично.'}</p>
    <button type="button" disabled={busy || pendingEdits || query.isFetching || query.isError || !report?.can_verify} onClick={() => onVerify({ ...driver, is_verified: false })} className="min-h-12 w-full rounded-xl bg-primary-500 px-4 py-3 font-semibold text-white disabled:bg-background-200 disabled:text-foreground-500 disabled:cursor-not-allowed">{busy ? 'Потвърждаваме…' : 'Верифицирай шофьора'}</button>
  </div>;
}

export default function AdminDrivers() {
  const { companyId } = useAdminCompany();
  const { user } = useAuth();
  return <CompanyDrivers key={JSON.stringify([user?.id, companyId])} />;
}

function CompanyDrivers() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { companyId, companies, companyName, loading: ctxLoading } = useAdminCompany();

  const now = useFleetClock();
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (search.trim() === searchTerm) return;
    const timer = setTimeout(() => { setSearchTerm(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(timer);
  }, [search, searchTerm]);
  const [selected, setSelected] = useState<DriverWithName | null>(null);
  const [notificationParams] = useSearchParams();
  const openedNotification = useRef('');
  const [documentDates,setDocumentDates] = useState<Record<string,string>>({});

  const [showAdd, setShowAdd] = useState(false);
  const [applicationsOnly, setApplicationsOnly] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [openingDocument, setOpeningDocument] = useState(false);
  const verifyLatch = useRef(false);
  const documentLatch = useRef(false);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const requestedApplication = notificationParams.get('application');
  const requestedDriver = notificationParams.get('driver');
  useEffect(() => {
    if (!companyId) return;
    const key = companyId + ':' + (requestedApplication ?? requestedDriver ?? '');
    if (openedNotification.current === key) return;
    if (requestedApplication && /^[0-9a-f-]{36}$/i.test(requestedApplication)) {
      openedNotification.current = key; setApplicationsOnly(true); setShowAdd(true); return;
    }
    if (!requestedDriver || !/^[0-9a-f-]{36}$/i.test(requestedDriver)) return;
    let active = true;
    void withRequestTimeout(signal => supabase.from('drivers').select('*').eq('company_id', companyId).eq('id', requestedDriver).abortSignal(signal).maybeSingle())
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) { setDocumentError('Шофьорът не е достъпен за тази фирма.'); return; }
        openedNotification.current = key;
        setSelected({ ...data, first_name: '', last_name: '', online_now: false, gps_received_at: null, gps_position_at: null });
      }).catch(() => { if (active) setDocumentError('Шофьорът не се зареди. Опитай отново.'); });
    return () => { active = false; };
  }, [companyId, requestedApplication, requestedDriver]);

  const driversQuery = useQuery({
    queryKey: [...queryKeys.adminDrivers(companyId ?? 'none'), searchTerm, page],
    queryFn: ({ signal }) => loadAdminDrivers(companyId!, searchTerm, page, signal),
    enabled: !!companyId, staleTime: 5_000, refetchInterval: 15_000, refetchOnWindowFocus: true, retry: 1,
  });
  const drivers = (driversQuery.data?.rows ?? []).map(driver => ({ ...driver, is_online: adminDriverOnline(driver, now) }));
  const total = driversQuery.data?.total ?? 0;
  useEffect(() => {
    if (driversQuery.isSuccess && page > 0 && page * ADMIN_PAGE_SIZE >= total) setPage(Math.max(0, Math.ceil(total / ADMIN_PAGE_SIZE) - 1));
  }, [driversQuery.isSuccess, page, total]);
  const error = driversQuery.error ? workflowError(driversQuery.error, 'Не успяхме да заредим шофьорите.') : '';
  const loading = driversQuery.isLoading;

  const documentsQuery = useQuery({
    queryKey: selected?.id ? queryKeys.driverDocuments(selected.id) : ['driver_documents', 'none'],
    queryFn: async ({ signal: querySignal }): Promise<DocumentRow[]> => {
      const { data, error } = await withRequestTimeout(signal => supabase
        .from('driver_documents')
        .select('*')
        .eq('driver_id', selected!.id)
        .order('created_at', { ascending: false }).abortSignal(signal), 10_000, querySignal);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selected?.id,
  });
  const documents = documentsQuery.data ?? [];
  const docLoading = documentsQuery.isLoading;

  const toggleVerifyMutation = useMutation({
    retry: false,
    mutationFn: async (d: DriverWithName) => {
      try {
        const { error } = await withRequestTimeout(signal => supabase.from('drivers')
          .update({ is_verified: !d.is_verified }).eq('id', d.id).eq('company_id', d.company_id)
          .eq('is_verified', d.is_verified).select('id').abortSignal(signal).single());
        if (error) throw error;
      } catch (error) {
        // A timed-out write may already have succeeded. Confirm once, never toggle again automatically.
        const check = await withRequestTimeout(signal => supabase.from('drivers').select('is_verified')
          .eq('id', d.id).eq('company_id', d.company_id).abortSignal(signal).single()).catch(() => null);
        if (check?.error || !check?.data || check.data.is_verified !== !d.is_verified) throw error;
      }
    },
    onSuccess: (_data, d) => {
      setSelected(current => current?.id === d.id ? { ...current, is_verified: !d.is_verified } : current);
    },
    onSettled: (_data, _error, d) => {
      verifyLatch.current = false;
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminDrivers(d.company_id) });
      void queryClient.invalidateQueries({ queryKey: verificationKey(d.id) });
    },
  });
  const setDocStatusMutation = useMutation({
    retry: false,
    mutationFn: async (input: { doc: DocumentRow; status: DocumentRow['status']; expires: string | null }) => {
      const { error } = await withRequestTimeout(signal => {
        const write = supabase.from('driver_documents').update({ status: input.status, expires_at: input.expires })
          .eq('id', input.doc.id).eq('company_id', input.doc.company_id).eq('driver_id', input.doc.driver_id).eq('status', input.doc.status);
        return (input.doc.expires_at === null ? write.is('expires_at', null) : write.eq('expires_at', input.doc.expires_at))
          .select('id').abortSignal(signal).single();
      });
      if (error?.code === 'PGRST116') throw new Error('Документът е променен от друг администратор. Прегледайте обновените данни преди повторен опит.');
      if (error) throw error;
    },
    onSuccess: (_data, input) => setDocumentDates(current => { const next = { ...current }; delete next[input.doc.id]; return next; }),
    onSettled: (_data, _error, input) => {
      documentLatch.current = false;
      void queryClient.invalidateQueries({ queryKey: queryKeys.driverDocuments(input.doc.driver_id) });
      void queryClient.invalidateQueries({ queryKey: verificationKey(input.doc.driver_id) });
    },
  });
  function reviewDocument(doc: DocumentRow, status: DocumentRow['status']) {
    if (documentLatch.current) return;
    documentLatch.current = true;
    setDocStatusMutation.mutate({ doc, status, expires: (documentDates[doc.id] ?? doc.expires_at) || null });
  }
  async function openDocument(doc: DocumentRow) {
    if (openingDocument) return;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setOpeningDocument(true); setDocumentError('');
    try {
      if (!tab) throw new Error('Разрешете отварянето на нов раздел за преглед на документа.');
      tab.location.replace(await signedDocumentUrl(doc.file_url));
    } catch (error) { tab?.close(); setDocumentError(workflowError(error, 'Документът не може да бъде отворен.')); }
    finally { setOpeningDocument(false); }
  }

  const filtered = drivers;

  return (
    <AdminLayout title={t('nav_drivers')}>
      {toggleVerifyMutation.isError && <p role="alert" className="mb-4 text-sm text-red-600">{workflowError(toggleVerifyMutation.error, 'Верификацията не е потвърдена.')}</p>}
      <p className="mb-4 text-sm text-foreground-500">От „Добави шофьор“ изпратете лична покана. В „Кандидатури за одобрение“ прегледайте документите, изберете автомобил и одобрете пакета наведнъж. За вече добавен шофьор използвайте „Детайли“. Отнемането на верификация спира новите заявки; започнатият курс може да бъде приключен.</p>
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          <button onClick={() => driversQuery.refetch()} className="ml-auto text-xs font-semibold underline cursor-pointer whitespace-nowrap">
            Опитай отново
          </button>
        </div>
      )}

      {/* Search */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Търси по име..."
            maxLength={80}
            aria-label="Търси шофьори"
            className="w-full pl-9 pr-4 py-2.5 bg-white rounded-xl border border-background-200 text-sm text-foreground-950 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <button
          onClick={() => { setApplicationsOnly(false); setShowAdd(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
        >
          <i className="ri-add-line" />
          Добави шофьор
        </button>
        <button type="button" onClick={() => { setApplicationsOnly(true); setShowAdd(true); }} className="min-h-11 rounded-lg border border-primary-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary-700">Кандидатури за одобрение</button>
        <div className="text-sm text-foreground-500 whitespace-nowrap">
          {driversQuery.data ? total : '—'} шофьори
        </div>
      </div>

      {/* Company filter hint for SUPER_ADMIN */}
      {isSuperAdmin && companies.length > 1 && (
        <div className="mb-3 flex items-center gap-2 text-sm text-foreground-500">
          <i className="ri-building-2-line" />
          <span>Филтър по фирма: <strong className="text-foreground-700">{companyName || '—'}</strong></span>
          <span className="text-foreground-300">·</span>
          <span className="text-foreground-400">Изберете фирма от селектора в горния десен ъгъл</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-background-100 text-center py-16">
          <i className="ri-steering-line text-4xl text-foreground-300" />
          <p className="text-foreground-500 mt-3">Няма намерени шофьори</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((d) => (
            <div key={d.id} className="bg-white rounded-2xl border border-background-100 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary-700 font-bold font-heading">
                    {(d.first_name.charAt(0) + d.last_name.charAt(0)).toUpperCase() || 'Ш'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground-950 truncate">
                    {d.first_name} {d.last_name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`flex items-center gap-1 text-xs ${d.is_online ? 'text-accent-600' : 'text-foreground-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${d.is_online ? 'bg-accent-500 animate-pulse' : 'bg-foreground-300'}`} />
                      {d.is_online ? 'Онлайн' : 'Офлайн'}
                    </span>
                    {d.is_verified && (
                      <span className="flex items-center gap-0.5 text-xs text-accent-600">
                        <i className="ri-verified-badge-fill" /> Верифициран
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {d.is_verified && !d.document_verification_required && <p className="mb-3 text-xs text-foreground-500">По-ранна верификация: проверете документите. За новите профили те са задължителни.</p>}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-background-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-foreground-950 font-heading">{parseFloat(String(d.rating || 0)).toFixed(1)}</p>
                  <p className="text-[11px] text-foreground-500">Рейтинг</p>
                </div>
                <div className="bg-background-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-foreground-950 font-heading">{d.total_trips || 0}</p>
                  <p className="text-[11px] text-foreground-500">Пътувания</p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { setSelected(d); setDocumentError(''); setDocStatusMutation.reset(); }}
                  className="flex-1 py-2 rounded-lg bg-background-100 text-foreground-700 text-sm font-medium hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Детайли
                </button>
                <button
                  onClick={() => {
                    if (!d.is_verified) { setSelected(d); setDocumentError(''); setDocStatusMutation.reset(); return; }
                    if (!verifyLatch.current) { verifyLatch.current = true; toggleVerifyMutation.mutate(d); }
                  }}
                  disabled={toggleVerifyMutation.isPending}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    d.is_verified
                      ? 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                      : 'bg-primary-500 text-white hover:bg-primary-600'
                  }`}
                >
                  {d.is_verified ? 'Отнеми верификация' : 'Верифицирай'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > ADMIN_PAGE_SIZE && <div className="flex items-center justify-between gap-3 mt-4 text-sm">
        <button disabled={page === 0 || driversQuery.isFetching || search.trim() !== searchTerm} onClick={() => setPage(p => p - 1)} className="px-4 py-2 rounded-lg border border-background-200 disabled:opacity-50">Предишни шофьори</button>
        <span>Страница {page + 1} от {Math.ceil(total / ADMIN_PAGE_SIZE)}</span>
        <button disabled={(page + 1) * ADMIN_PAGE_SIZE >= total || driversQuery.isFetching || search.trim() !== searchTerm} onClick={() => setPage(p => p + 1)} className="px-4 py-2 rounded-lg border border-background-200 disabled:opacity-50">Следващи шофьори</button>
      </div>}

      {/* Add Driver Modal */}
      {showAdd && (
        <Modal label={applicationsOnly ? 'Кандидатури за одобрение' : 'Добави нов шофьор'} onClose={() => setShowAdd(false)} className="max-w-2xl">
          <div className="relative bg-white rounded-2xl w-full max-w-2xl animate-in zoom-in-95 fade-in duration-200">
            <div className="px-5 py-4 border-b border-background-100 flex items-center justify-between bg-white">
              <h3 className="font-semibold text-foreground-950 font-heading">{applicationsOnly ? 'Кандидатури за одобрение' : 'Добави нов шофьор'}</h3>
              <button
                aria-label="Затвори поканите"
                onClick={() => setShowAdd(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line text-foreground-600 text-lg" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="font-medium">{companyName || 'Изберете фирма от селектора в панела'}</p>
              {companyId && <DriverApplications key={companyId} companyId={companyId} showInvitations={!applicationsOnly} />}
            </div>
          </div>
        </Modal>
      )}

      {/* Detail Modal */}
      {selected && (
        <Modal label="Документи на шофьора" onClose={() => setSelected(null)} busy={setDocStatusMutation.isPending || toggleVerifyMutation.isPending} className="max-w-lg">
          <div className="relative bg-white rounded-2xl w-full max-w-lg animate-in zoom-in-95 fade-in duration-200">
            <div className="px-5 py-4 border-b border-background-100 flex items-center justify-between bg-white">
              <div>
                <h3 className="font-semibold text-foreground-950 font-heading">
                  {selected.first_name} {selected.last_name}
                </h3>
                <p className="text-xs text-foreground-500">Документи на шофьора</p>
              </div>
              <button
                aria-label="Затвори документите"
                onClick={() => setSelected(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line text-foreground-600 text-lg" />
              </button>
            </div>

            <div className="p-5">
              <DriverVerificationStatus key={selected.id} driverId={selected.id} />
              {toggleVerifyMutation.isError && <p role="alert" className="text-sm text-red-600 mb-3">{workflowError(toggleVerifyMutation.error, 'Верификацията не е потвърдена. Обновете проверката.')}</p>}
              {documentError && <p role="alert" className="text-sm text-red-600 mb-3">{documentError}</p>}
              {setDocStatusMutation.isError && <p role="alert" className="text-sm text-red-600 mb-3">{workflowError(setDocStatusMutation.error, 'Промяната не е потвърдена. Обновете документите.')}</p>}
              {documentsQuery.isError ? <p role="alert" className="text-sm text-red-600">Документите не са заредени. <button className="underline" onClick={() => void documentsQuery.refetch()}>Опитай отново</button></p> : docLoading ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : documents.length === 0 ? (
                <div className="text-center py-10">
                  <i className="ri-file-line text-3xl text-foreground-300" />
                  <p className="text-sm text-foreground-400 mt-2">Няма качени документи</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {documents.map((doc) => (
                    <div key={doc.id} className="border border-background-100 rounded-xl p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-background-100 flex items-center justify-center flex-shrink-0">
                          <i className="ri-file-text-line text-foreground-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground-900">{DOC_LABELS[doc.type] || doc.type}</p>
                          <p className="text-xs text-foreground-400 mt-0.5">
                            {new Date(doc.created_at).toLocaleDateString('bg-BG')}
                          </p>
                        </div>
                        <span
                          className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                            doc.status === 'approved'
                              ? 'bg-primary-100 text-primary-700'
                              : doc.status === 'rejected'
                              ? 'bg-red-100 text-red-600'
                              : 'bg-primary-100 text-primary-700'
                          }`}
                        >
                          {documentExpired(doc.expires_at) ? 'Изтекъл срок' : doc.status === 'approved' ? 'Одобрен' : doc.status === 'rejected' ? 'Отхвърлен' : 'Изчаква'}
                        </span>
                      </div>

                      <label className="block text-xs text-foreground-500 mt-3">Валиден до<input aria-label={'Валиден до '+doc.id} type="date" value={documentDates[doc.id] ?? doc.expires_at ?? ''} onChange={e=>setDocumentDates({...documentDates,[doc.id]:e.target.value})} className="block w-full rounded-lg border border-background-200 p-2 mt-1"/></label>
                      <div className="flex gap-2 mt-3 pt-3 border-t border-background-100">
                        <button type="button" disabled={openingDocument}
                          onClick={() => void openDocument(doc)}
                          className="flex-1 py-2 rounded-lg bg-background-100 text-foreground-700 text-xs font-medium hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer text-center"
                        >
                          Преглед
                        </button>
                        {(doc.status !== 'approved' || documentDates[doc.id] !== undefined) && (
                          <button
                            disabled={setDocStatusMutation.isPending}
                            onClick={() => reviewDocument(doc, 'approved')}
                            className="flex-1 py-2 rounded-lg bg-primary-500 text-white text-xs font-medium hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
                          >
                            Одобри
                          </button>
                        )}
                        {doc.status !== 'rejected' && (
                          <button
                            disabled={setDocStatusMutation.isPending}
                            onClick={() => reviewDocument(doc, 'rejected')}
                            className="flex-1 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors whitespace-nowrap cursor-pointer"
                          >
                            Отхвърли
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <VerificationAction driver={selected} pendingEdits={documents.some(doc => documentDates[doc.id] !== undefined && documentDates[doc.id] !== (doc.expires_at ?? ''))} busy={setDocStatusMutation.isPending || toggleVerifyMutation.isPending || documentsQuery.isFetching} onVerify={d => { if (!verifyLatch.current) { verifyLatch.current = true; toggleVerifyMutation.mutate(d); } }} />
            </div>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
