import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import AdminLayout from '@/pages/admin/components/AdminLayout';

interface Company {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  currency: string;
  base_fare: number;
  price_per_km: number;
  price_per_minute: number;
  dispatch_radius_km: number;
  is_active: boolean;
  created_at: string;
  drivers_count: number;
}

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  base_fare: '2.00',
  price_per_km: '1.10',
  price_per_minute: '0.28',
  dispatch_radius_km: '5',
};

export default function AdminCompanies() {
  const { t } = useTranslation();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('companies')
        .select('id, name, phone, email, address, currency, base_fare, price_per_km, price_per_minute, dispatch_radius_km, is_active, created_at')
        .order('created_at', { ascending: false });

      if (err) throw err;

      const companyIds = (data || []).map((c) => c.id);
      let countMap: Record<string, number> = {};
      if (companyIds.length > 0) {
        const { data: drivers } = await supabase
          .from('drivers')
          .select('company_id')
          .in('company_id', companyIds);
        countMap = (drivers || []).reduce(
          (acc, d) => ({ ...acc, [d.company_id]: (acc[d.company_id] || 0) + 1 }),
          {} as Record<string, number>
        );
      }

      setCompanies(
        (data || []).map((c) => ({
          ...c,
          base_fare: parseFloat(String(c.base_fare || 0)),
          price_per_km: parseFloat(String(c.price_per_km || 0)),
          price_per_minute: parseFloat(String(c.price_per_minute || 0)),
          dispatch_radius_km: parseFloat(String(c.dispatch_radius_km || 0)),
          drivers_count: countMap[c.id] || 0,
        })) as Company[]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при зареждане';
      setError(msg);
      console.error('Companies error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  const setField = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const slug = form.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const { data, error: err } = await supabase
        .from('companies')
        .insert({
          name: form.name.trim(),
          slug: slug || 'company',
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          currency: 'EUR',
          base_fare: parseFloat(form.base_fare) || 2.0,
          price_per_km: parseFloat(form.price_per_km) || 1.1,
          price_per_minute: parseFloat(form.price_per_minute) || 0.28,
          dispatch_radius_km: parseFloat(form.dispatch_radius_km) || 5,
          is_active: true,
        })
        .select('id')
        .single();

      if (err) throw err;

      setForm(emptyForm);
      setShowForm(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      fetchCompanies();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при запис';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout title="Фирми">
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          <button onClick={() => setError('')} className="ml-auto w-5 h-5 flex items-center justify-center cursor-pointer">
            <i className="ri-close-line text-red-400 text-xs" />
          </button>
        </div>
      )}

      {saved && (
        <div className="mb-4 bg-primary-50 text-primary-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-check-double-line" />
          Фирмата е добавена успешно.
        </div>
      )}

      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-foreground-500">{companies.length} фирми</div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
        >
          <i className="ri-add-line" />
          Добави фирма
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : companies.length === 0 ? (
        <div className="bg-white rounded-2xl border border-background-100 text-center py-16">
          <i className="ri-building-2-line text-4xl text-foreground-300" />
          <p className="text-foreground-500 mt-3">Няма добавени фирми</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 px-4 py-2.5 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
          >
            Добави първата фирма
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {companies.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl border border-background-100 p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <i className="ri-building-2-line text-primary-600 text-lg" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground-950 font-heading truncate">{c.name}</p>
                    <p className="text-xs text-foreground-500">{c.currency}</p>
                  </div>
                </div>
                {c.is_active && (
                  <span className="text-[11px] font-semibold text-primary-600 bg-primary-100 px-2 py-1 rounded-full whitespace-nowrap">
                    Активна
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Шофьори</p>
                  <p className="text-foreground-800">{c.drivers_count}</p>
                </div>
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Начална такса</p>
                  <p className="text-foreground-800">{c.base_fare.toFixed(2)} €</p>
                </div>
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Цена на км</p>
                  <p className="text-foreground-800">{c.price_per_km.toFixed(2)} €</p>
                </div>
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Цена на минута</p>
                  <p className="text-foreground-800">{c.price_per_minute.toFixed(2)} €</p>
                </div>
              </div>

              <div className="space-y-1 text-xs text-foreground-500 mb-4">
                {c.address && (
                  <p className="flex items-center gap-1.5 truncate">
                    <i className="ri-map-pin-line text-foreground-400" />
                    {c.address}
                  </p>
                )}
                {c.phone && (
                  <p className="flex items-center gap-1.5">
                    <i className="ri-phone-line text-foreground-400" />
                    {c.phone}
                  </p>
                )}
                {c.email && (
                  <p className="flex items-center gap-1.5 truncate">
                    <i className="ri-mail-line text-foreground-400" />
                    {c.email}
                  </p>
                )}
              </div>

              <p className="text-[11px] text-foreground-400">
                Добавена: {new Date(c.created_at).toLocaleDateString('bg-BG')}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Add Company Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowForm(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-200">
            <div className="px-5 py-4 border-b border-background-100 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="font-semibold text-foreground-950 font-heading">Добави нова фирма</h3>
              <button
                onClick={() => setShowForm(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line text-foreground-600 text-lg" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-foreground-500 block mb-1">Име на фирмата *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="Напр. Лески Каручка"
                  className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Телефон</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setField('phone', e.target.value)}
                    placeholder="+359..."
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Имейл</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setField('email', e.target.value)}
                    placeholder="info@..."
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-foreground-500 block mb-1">Адрес</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setField('address', e.target.value)}
                  placeholder="Адрес на офиса"
                  className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Начална такса (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.base_fare}
                    onChange={(e) => setField('base_fare', e.target.value)}
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Цена на км (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.price_per_km}
                    onChange={(e) => setField('price_per_km', e.target.value)}
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Цена на минута (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.price_per_minute}
                    onChange={(e) => setField('price_per_minute', e.target.value)}
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 block mb-1">Радиус (км)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={form.dispatch_radius_km}
                    onChange={(e) => setField('dispatch_radius_km', e.target.value)}
                    className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
              </div>

              <div className="bg-primary-50 text-primary-800 text-xs rounded-xl px-3 py-2.5 flex items-center gap-2">
                <i className="ri-information-line" />
                Всички цени на новата фирма са в евро (€).
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
                  disabled={saving || !form.name.trim()}
                  className="flex-1 py-2.5 bg-primary-500 text-white font-medium rounded-xl hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer text-sm disabled:opacity-50"
                >
                  {saving ? t('loading') : 'Добави фирма'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}