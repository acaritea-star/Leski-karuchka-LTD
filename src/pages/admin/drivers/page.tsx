import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import type { Tables } from '@/lib/database.types';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import { useAuth } from '@/hooks/useAuth';

type DriverWithName = Tables<'drivers'> & { first_name: string; last_name: string };
type DocumentRow = Tables<'driver_documents'>;

const DOC_LABELS: Record<string, string> = {
  license: 'Шофьорска книжка',
  id_card: 'Лична карта',
  insurance: 'Застраховка',
};

const emptyForm = { first_name: '', last_name: '', email: '', phone: '', password: '' };

export default function AdminDrivers() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { companyId, companies, companyName, loading: ctxLoading } = useAdminCompany();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DriverWithName | null>(null);

  // Add driver state
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(emptyForm);
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState(false);
  const [modalCompanyId, setModalCompanyId] = useState<string>('');

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (showAdd) {
      setModalCompanyId(companyId || '');
      setAddError('');
      setAddSuccess(false);
    }
  }, [showAdd, companyId]);

  const driversQuery = useQuery({
    queryKey: companyId ? queryKeys.adminDrivers(companyId) : ['drivers', 'company', 'none'],
    queryFn: async (): Promise<DriverWithName[]> => {
      const { data: driversRaw, error } = await supabase
        .from('drivers')
        .select('*')
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const list = driversRaw ?? [];
      const userIds = list.map((d) => d.user_id);

      const profileMap: Record<string, Tables<'profiles'>> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', userIds);
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
  const error = driversQuery.error instanceof Error ? driversQuery.error.message : '';
  const loading = driversQuery.isLoading;

  const documentsQuery = useQuery({
    queryKey: selected?.id ? queryKeys.driverDocuments(selected.id) : ['driver_documents', 'none'],
    queryFn: async (): Promise<DocumentRow[]> => {
      const { data, error } = await supabase
        .from('driver_documents')
        .select('*')
        .eq('driver_id', selected!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selected?.id,
  });
  const documents = documentsQuery.data ?? [];
  const docLoading = documentsQuery.isLoading;

  const toggleVerifyMutation = useMutation({
    mutationFn: async (d: DriverWithName) => {
      const { error } = await supabase
        .from('drivers')
        .update({ is_verified: !d.is_verified })
        .eq('id', d.id);
      if (error) throw error;
    },
    onSuccess: () => {
      if (companyId) queryClient.invalidateQueries({ queryKey: queryKeys.adminDrivers(companyId) });
    },
  });

  const setDocStatusMutation = useMutation({
    mutationFn: async (input: { doc: DocumentRow; status: DocumentRow['status'] }) => {
      const { error } = await supabase
        .from('driver_documents')
        .update({ status: input.status, reviewed_at: new Date().toISOString() })
        .eq('id', input.doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      if (selected?.id) queryClient.invalidateQueries({ queryKey: queryKeys.driverDocuments(selected.id) });
    },
  });

  const addDriverMutation = useMutation({
    mutationFn: async (input: { targetCompanyId: string; form: typeof addForm }) => {
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: input.form.email.trim(),
        password: input.form.password,
        options: {
          data: {
            role: 'DRIVER',
            first_name: input.form.first_name.trim(),
            last_name: input.form.last_name.trim(),
            phone: input.form.phone.trim(),
            company_id: input.targetCompanyId,
          },
        },
      });

      if (signUpErr) throw signUpErr;
      if (!signUpData.user) throw new Error('Email-ът вече е регистриран в системата');

      const { error: driverErr } = await supabase.from('drivers').insert({
        user_id: signUpData.user.id,
        company_id: input.targetCompanyId,
        is_online: false,
        is_verified: false,
        rating: 5,
        total_trips: 0,
      });
      if (driverErr) throw new Error('Грешка при създаване на шофьор: ' + driverErr.message);
    },
    onSuccess: () => {
      setAddForm(emptyForm);
      setModalCompanyId(companyId || '');
      setAddSuccess(true);
      setTimeout(() => setAddSuccess(false), 2500);
      setShowAdd(false);
      if (companyId) queryClient.invalidateQueries({ queryKey: queryKeys.adminDrivers(companyId) });
    },
    onError: (err) => {
      setAddError(err instanceof Error ? err.message : 'Грешка при добавяне на шофьор');
    },
  });

  const addField = (key: keyof typeof addForm, value: string) =>
    setAddForm((prev) => ({ ...prev, [key]: value }));

  const handleAddDriver = () => {
    const targetCompanyId = isSuperAdmin ? modalCompanyId : companyId;

    if (!targetCompanyId) {
      setAddError(isSuperAdmin ? 'Изберете фирма от падащото меню.' : 'Не е заредена фирма. Презаредете страницата.');
      return;
    }
    if (!addForm.first_name.trim()) {
      setAddError('Въведете име на шофьора.');
      return;
    }
    if (!addForm.last_name.trim()) {
      setAddError('Въведете фамилия на шофьора.');
      return;
    }
    if (!addForm.email.trim()) {
      setAddError('Въведете имейл адрес.');
      return;
    }
    if (addForm.password.length < 6) {
      setAddError('Паролата трябва да е поне 6 символа.');
      return;
    }

    setAddError('');
    setAddSuccess(false);
    addDriverMutation.mutate({ targetCompanyId, form: addForm });
  };

  const filtered = drivers.filter((d) =>
    `${d.first_name} ${d.last_name}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AdminLayout title={t('nav_drivers')}>
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
                  onClick={() => setSelected(d)}
                  className="flex-1 py-2 rounded-lg bg-background-100 text-foreground-700 text-sm font-medium hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Детайли
                </button>
                <button
                  onClick={() => toggleVerifyMutation.mutate(d)}
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
              {/* Company selector */}
              <div className="rounded-xl border border-background-200 p-3 space-y-2 bg-background-50/50">
                <label className="text-xs font-semibold text-foreground-700 block flex items-center gap-1">
                  <i className="ri-building-2-line" />
                  Фирма / Автопарк *
                </label>
                {ctxLoading ? (
                  <div className="flex items-center gap-2 text-sm text-foreground-400">
                    <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                    Зареждане на фирми…
                  </div>
                ) : isSuperAdmin ? (
                  <div className="relative">
                    <select
                      value={modalCompanyId}
                      onChange={(e) => setModalCompanyId(e.target.value)}
                      className="w-full pl-9 pr-8 py-2.5 bg-white rounded-xl border border-background-200 text-sm text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200 cursor-pointer appearance-none"
                    >
                      <option value="" disabled>
                        Избери фирма…
                      </option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <i className="ri-building-2-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" />
                    <i className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-foreground-700">
                    <i className="ri-building-2-line text-primary-500" />
                    <span className="font-medium">{companyName || 'Неизвестна фирма'}</span>
                  </div>
                )}
                <p className="text-xs text-foreground-400">
                  {isSuperAdmin
                    ? 'Като супер админ можете да добавяте шофьори към всяка фирма.'
                    : 'Шофьорът ще бъде добавен към фирмата, с която сте свързани.'}
                </p>
              </div>

              {addSuccess && (
                <div className="flex items-center gap-2 bg-primary-50 text-primary-600 text-sm rounded-xl px-4 py-3">
                  <i className="ri-check-double-line" />
                  Шофьорът е добавен успешно.
                </div>
              )}
              {addError && (
                <div className="flex items-center gap-2 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3">
                  <i className="ri-error-warning-line flex-shrink-0" />
                  <span className="break-words">{addError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Име *</label>
                  <input
                    type="text"
                    value={addForm.first_name}
                    onChange={(e) => addField('first_name', e.target.value)}
                    placeholder="Иван"
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Фамилия *</label>
                  <input
                    type="text"
                    value={addForm.last_name}
                    onChange={(e) => addField('last_name', e.target.value)}
                    placeholder="Петров"
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-foreground-500 block mb-1">Имейл *</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => addField('email', e.target.value)}
                  placeholder="driver@email.com"
                  className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Телефон</label>
                  <input
                    type="text"
                    value={addForm.phone}
                    onChange={(e) => addField('phone', e.target.value)}
                    placeholder="+359..."
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Парола * (мин. 6)</label>
                  <input
                    type="password"
                    value={addForm.password}
                    onChange={(e) => addField('password', e.target.value)}
                    placeholder="минимум 6 символа"
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
              </div>

              <div className="bg-background-50 text-foreground-500 text-xs rounded-xl px-3 py-2.5 flex items-center gap-2">
                <i className="ri-information-line flex-shrink-0" />
                Шофьорът ще влиза в приложението с този имейл и парола.
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowAdd(false)}
                  className="flex-1 py-2.5 bg-background-100 text-foreground-600 font-medium rounded-xl hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer text-sm"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleAddDriver}
                  disabled={addDriverMutation.isPending}
                  className="flex-1 py-2.5 bg-primary-500 text-white font-medium rounded-xl hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer text-sm disabled:opacity-50"
                >
                  {addDriverMutation.isPending ? t('loading') : 'Добави шофьор'}
                </button>
              </div>
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
              {docLoading ? (
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
                          {doc.status === 'approved' ? 'Одобрен' : doc.status === 'rejected' ? 'Отхвърлен' : 'Изчаква'}
                        </span>
                      </div>

                      <div className="flex gap-2 mt-3 pt-3 border-t border-background-100">
                        <a
                          href={doc.file_url || '#'}
                          target="_blank"
                          rel="nofollow noopener noreferrer"
                          className="flex-1 py-2 rounded-lg bg-background-100 text-foreground-700 text-xs font-medium hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer text-center"
                        >
                          Преглед
                        </a>
                        {doc.status !== 'approved' && (
                          <button
                            onClick={() => setDocStatusMutation.mutate({ doc, status: 'approved' })}
                            className="flex-1 py-2 rounded-lg bg-primary-500 text-white text-xs font-medium hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
                          >
                            Одобри
                          </button>
                        )}
                        {doc.status !== 'rejected' && (
                          <button
                            onClick={() => setDocStatusMutation.mutate({ doc, status: 'rejected' })}
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