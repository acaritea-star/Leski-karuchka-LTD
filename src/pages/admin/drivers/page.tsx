import DriverVerificationStatus from '@/components/feature/DriverVerificationStatus';
import { verificationKey } from '@/lib/driverVerification';
import DriverApplications from './DriverApplications';
import { signedDocumentUrl, workflowError } from '@/lib/driverDocuments';
import { useState, useRef } from 'react';
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

type DriverWithName = Tables<'drivers'> & { first_name: string; last_name: string };
type DocumentRow = Tables<'driver_documents'>;

const DOC_LABELS: Record<string, string> = {
  license: 'Шофьорска книжка',
  id_card: 'Лична карта',
  insurance: 'Застраховка',
};


export default function AdminDrivers() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { companyId, companies, companyName, loading: ctxLoading } = useAdminCompany();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DriverWithName | null>(null);
  const [documentDates,setDocumentDates] = useState<Record<string,string>>({});

  const [showAdd, setShowAdd] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [openingDocument, setOpeningDocument] = useState(false);
  const verifyLatch = useRef(false);
  const documentLatch = useRef(false);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const driversQuery = useQuery({
    queryKey: companyId ? queryKeys.adminDrivers(companyId) : ['drivers', 'company', 'none'],
    queryFn: async (): Promise<DriverWithName[]> => {
      const { data: driversRaw, error } = await withRequestTimeout(signal => supabase
        .from('drivers')
        .select('*')
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false }).abortSignal(signal));
      if (error) throw error;

      const list = driversRaw ?? [];
      const userIds = list.map((d) => d.user_id);

      const profileMap: Record<string, Tables<'profiles'>> = {};
      if (userIds.length > 0) {
        const { data: profiles, error: profileError } = await withRequestTimeout(signal => supabase
          .from('profiles')
          .select('*')
          .in('id', userIds).abortSignal(signal));
        if (profileError) throw profileError;
        for (const p of profiles ?? []) profileMap[p.id] = p;
      }

      return list.map((d) => ({
        ...d,
        first_name: profileMap[d.user_id]?.first_name ?? '—',
        last_name: profileMap[d.user_id]?.last_name ?? '',
      }));
    },
    enabled: !!companyId,
  });

  const drivers = driversQuery.data ?? [];
  const error = driversQuery.error ? workflowError(driversQuery.error, 'Не успяхме да заредим шофьорите.') : '';
  const loading = driversQuery.isLoading;

  const documentsQuery = useQuery({
    queryKey: selected?.id ? queryKeys.driverDocuments(selected.id) : ['driver_documents', 'none'],
    queryFn: async (): Promise<DocumentRow[]> => {
      const { data, error } = await withRequestTimeout(signal => supabase
        .from('driver_documents')
        .select('*')
        .eq('driver_id', selected!.id)
        .order('created_at', { ascending: false }).abortSignal(signal));
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
          .eq('id', d.id).abortSignal(signal).single()).catch(() => null);
        if (check?.error || !check?.data || check.data.is_verified !== !d.is_verified) throw error;
      }
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
      const { error } = await withRequestTimeout(signal => supabase.from('driver_documents')
        .update({ status: input.status, expires_at: input.expires }).eq('id', input.doc.id)
        .eq('status', input.doc.status).select('id').abortSignal(signal).single());
      if (error) throw error;
    },
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

  const filtered = drivers.filter((d) =>
    `${d.first_name} ${d.last_name}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AdminLayout title={t('nav_drivers')}>
      {toggleVerifyMutation.isError && <p role="alert" className="mb-4 text-sm text-red-600">{workflowError(toggleVerifyMutation.error, 'Верификацията не е потвърдена.')}</p>}
      <p className="mb-4 text-sm text-foreground-500">За верификация: шофьорът лично завършва подготовката и приема условията в своя профил. Одобрете валидни книжка и застраховка от „Детайли“ и назначете активен автомобил от „Автомобили“. Отнемането на верификация спира новите заявки; започнатият курс може да бъде приключен.</p>
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
            className="w-full pl-9 pr-4 py-2.5 bg-white rounded-xl border border-background-200 text-sm text-foreground-950 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
        >
          <i className="ri-add-line" />
          Добави шофьор
        </button>
        <div className="text-sm text-foreground-500 whitespace-nowrap">
          {drivers.length} шофьори
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
                  onClick={() => { if (!verifyLatch.current) { verifyLatch.current = true; toggleVerifyMutation.mutate(d); } }}
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

      {/* Add Driver Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAdd(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-200">
            <div className="px-5 py-4 border-b border-background-100 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="font-semibold text-foreground-950 font-heading">Добави нов шофьор</h3>
              <button
                onClick={() => setShowAdd(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line text-foreground-600 text-lg" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="font-medium">{companyName || 'Изберете фирма от селектора в панела'}</p>
              {companyId && <DriverApplications key={companyId} companyId={companyId} />}
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelected(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-200">
            <div className="px-5 py-4 border-b border-background-100 flex items-center justify-between sticky top-0 bg-white">
              <div>
                <h3 className="font-semibold text-foreground-950 font-heading">
                  {selected.first_name} {selected.last_name}
                </h3>
                <p className="text-xs text-foreground-500">Документи на шофьора</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line text-foreground-600 text-lg" />
              </button>
            </div>

            <div className="p-5">
              <DriverVerificationStatus key={selected.id} driverId={selected.id} />
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
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
