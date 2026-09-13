import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import type { Tables } from '@/lib/database.types';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';

type VehicleWithDriver = Tables<'vehicles'> & { driver_id: string | null; driver_name: string | null };
type DriverOption = { id: string; name: string };

const emptyForm = {
  make: '',
  model: '',
  year: '',
  color: '',
  registration_number: '',
  vehicle_type_id: '',
  capacity: '4',
  driver_id: '',
};

export default function AdminVehicles() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { companyId } = useAdminCompany();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VehicleWithDriver | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const vehiclesQuery = useQuery({
    queryKey: companyId ? queryKeys.adminVehicles(companyId) : ['vehicles', 'company', 'none'],
    queryFn: async (): Promise<{ vehicles: VehicleWithDriver[]; drivers: DriverOption[]; vehicleTypes: Tables<'vehicle_types'>[] }> => {
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const { data: drivers } = await supabase
        .from('drivers')
        .select('id, user_id, vehicle_id')
        .eq('company_id', companyId!);
      const driverList = drivers ?? [];

      const userIds = driverList.map((d) => d.user_id);
      const nameMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', userIds);
        for (const p of profiles ?? []) {
          nameMap[p.id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Шофьор';
        }
      }

      const { data: vehicleTypes } = await supabase
        .from('vehicle_types')
        .select('*')
        .eq('company_id', companyId!);

      const driverOptions: DriverOption[] = driverList.map((d) => ({
        id: d.id,
        name: nameMap[d.user_id] || 'Шофьор',
      }));

      const vehiclesWithDriver: VehicleWithDriver[] = (vehicles ?? []).map((v) => {
        const assigned = driverList.find((d) => d.vehicle_id === v.id);
        return {
          ...v,
          driver_id: assigned?.id ?? null,
          driver_name: assigned ? (nameMap[assigned.user_id] || 'Шофьор') : null,
        };
      });

      return { vehicles: vehiclesWithDriver, drivers: driverOptions, vehicleTypes: vehicleTypes ?? [] };
    },
    enabled: !!companyId,
  });

  const vehicles = vehiclesQuery.data?.vehicles ?? [];
  const drivers = vehiclesQuery.data?.drivers ?? [];
  const vehicleTypes = useMemo(() => vehiclesQuery.data?.vehicleTypes ?? [], [vehiclesQuery.data?.vehicleTypes]);
  const loading = vehiclesQuery.isLoading;
  const queryError = vehiclesQuery.error instanceof Error ? vehiclesQuery.error.message : '';

  const typeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const vt of vehicleTypes) map.set(vt.id, vt.name);
    return map;
  }, [vehicleTypes]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (v: VehicleWithDriver) => {
    setEditing(v);
    setForm({
      make: v.make,
      model: v.model,
      year: v.year ? String(v.year) : '',
      color: v.color || '',
      registration_number: v.registration_number || '',
      vehicle_type_id: v.vehicle_type_id || '',
      capacity: v.capacity ? String(v.capacity) : '4',
      driver_id: v.driver_id || '',
    });
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (input: { editing: VehicleWithDriver | null; form: typeof emptyForm }) => {
      if (!companyId) throw new Error('Не е заредена фирма');
      const { editing, form } = input;

      const payload = {
        company_id: companyId,
        make: form.make.trim(),
        model: form.model.trim(),
        year: form.year ? parseInt(form.year, 10) : null,
        color: form.color.trim() || null,
        registration_number: form.registration_number.trim(),
        vehicle_type_id: form.vehicle_type_id || null,
        capacity: form.capacity ? parseInt(form.capacity, 10) : 4,
        is_active: true,
      };

      let vehicleId: string;
      if (editing) {
        const { error } = await supabase.from('vehicles').update(payload).eq('id', editing.id);
        if (error) throw error;
        vehicleId = editing.id;
      } else {
        const { data, error } = await supabase.from('vehicles').insert(payload).select('id').single();
        if (error) throw error;
        vehicleId = data.id;
      }

      if (form.driver_id) {
        const { error } = await supabase
          .from('drivers')
          .update({ vehicle_id: vehicleId })
          .eq('id', form.driver_id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setShowForm(false);
      setError('');
      if (companyId) queryClient.invalidateQueries({ queryKey: queryKeys.adminVehicles(companyId) });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Грешка при запис');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('vehicles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      setDeleteId(null);
      if (companyId) queryClient.invalidateQueries({ queryKey: queryKeys.adminVehicles(companyId) });
    },
  });

  const handleSave = () => {
    if (!form.make.trim() || !form.model.trim()) return;
    setError('');
    saveMutation.mutate({ editing, form });
  };

  const setField = (key: keyof typeof emptyForm, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <AdminLayout title={t('nav_vehicles')}>
      {(error || queryError) && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error || queryError}
          <button onClick={() => setError('')} className="ml-auto w-5 h-5 flex items-center justify-center cursor-pointer">
            <i className="ri-close-line text-red-400 text-xs" />
          </button>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-foreground-500">{vehicles.length} автомобила</div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
        >
          <i className="ri-add-line" />
          Добави автомобил
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : vehicles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-background-100 text-center py-16">
          <i className="ri-car-line text-4xl text-foreground-300" />
          <p className="text-foreground-500 mt-3">Няма превозни средства</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {vehicles.map((v) => (
            <div key={v.id} className="bg-white rounded-2xl border border-background-100 p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-lg bg-primary-100 flex items-center justify-center">
                    <i className="ri-car-line text-primary-600 text-lg" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground-950 font-heading">
                      {v.make} {v.model}
                    </p>
                    <p className="text-xs text-foreground-500">{v.year || '—'}</p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-foreground-600 bg-background-100 px-2 py-1 rounded-md uppercase">
                  {v.registration_number || '—'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Цвят</p>
                  <p className="text-foreground-800 capitalize">{v.color || '—'}</p>
                </div>
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Тип</p>
                  <p className="text-foreground-800 capitalize">
                    {v.vehicle_type_id ? typeNameById.get(v.vehicle_type_id) || '—' : '—'}
                  </p>
                </div>
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Места</p>
                  <p className="text-foreground-800">{v.capacity || '—'}</p>
                </div>
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Шофьор</p>
                  <p className="text-foreground-800 truncate">{v.driver_name || '—'}</p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => openEdit(v)}
                  className="flex-1 py-2 rounded-lg bg-background-100 text-foreground-700 text-sm font-medium hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Редактирай
                </button>
                <button
                  onClick={() => setDeleteId(v.id)}
                  className="w-10 h-9 flex items-center justify-center rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors cursor-pointer"
                >
                  <i className="ri-delete-bin-line text-sm" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowForm(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-200">
            <div className="px-5 py-4 border-b border-background-100 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="font-semibold text-foreground-950 font-heading">
                {editing ? 'Редактирай автомобил' : 'Добави автомобил'}
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line text-foreground-600 text-lg" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Марка</label>
                  <input
                    type="text"
                    value={form.make}
                    onChange={(e) => setField('make', e.target.value)}
                    placeholder="Toyota"
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Модел</label>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) => setField('model', e.target.value)}
                    placeholder="Prius"
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Година</label>
                  <input
                    type="number"
                    value={form.year}
                    onChange={(e) => setField('year', e.target.value)}
                    placeholder="2022"
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Цвят</label>
                  <input
                    type="text"
                    value={form.color}
                    onChange={(e) => setField('color', e.target.value)}
                    placeholder="Бял"
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-foreground-500 block mb-1">Рег. номер</label>
                <input
                  type="text"
                  value={form.registration_number}
                  onChange={(e) => setField('registration_number', e.target.value)}
                  placeholder="CB 1234 AB"
                  className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Тип</label>
                  <select
                    value={form.vehicle_type_id}
                    onChange={(e) => setField('vehicle_type_id', e.target.value)}
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  >
                    <option value="">Без тип</option>
                    {vehicleTypes.map((vt) => (
                      <option key={vt.id} value={vt.id}>
                        {vt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Места</label>
                  <input
                    type="number"
                    value={form.capacity}
                    onChange={(e) => setField('capacity', e.target.value)}
                    placeholder="4"
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-foreground-500 block mb-1">Шофьор</label>
                <select
                  value={form.driver_id}
                  onChange={(e) => setField('driver_id', e.target.value)}
                  className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                >
                  <option value="">Без шофьор</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 bg-background-100 text-foreground-600 font-medium rounded-xl hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer text-sm"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending || !form.make.trim() || !form.model.trim()}
                  className="flex-1 py-2.5 bg-primary-500 text-white font-medium rounded-xl hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer text-sm disabled:opacity-50"
                >
                  {saveMutation.isPending ? t('loading') : t('save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteId(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-6 text-center animate-in zoom-in-95 fade-in duration-200">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
              <i className="ri-delete-bin-line text-red-500 text-lg" />
            </div>
            <h3 className="font-semibold text-foreground-950 mb-1">Изтриване на автомобил</h3>
            <p className="text-sm text-foreground-500 mb-4">Сигурни ли сте, че искате да изтриете този автомобил?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 py-2.5 bg-background-100 text-foreground-600 font-medium rounded-xl hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer text-sm"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 text-white font-medium rounded-xl hover:bg-red-600 transition-colors whitespace-nowrap cursor-pointer text-sm disabled:opacity-50"
              >
                Изтрий
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}