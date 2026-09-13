import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import { estimateDuration } from '@/lib/geo';
import { calculateFare, DEFAULT_CURRENCY } from '@/lib/pricing';

interface PricingConfig {
  base_fare: number;
  price_per_km: number;
  price_per_minute: number;
  dispatch_radius_km: number;
  currency: string;
}

export default function AdminPricing() {
  const { t } = useTranslation();
  const { companyId } = useAdminCompany();

  const [config, setConfig] = useState<PricingConfig>({
    base_fare: 2.0,
    price_per_km: 1.1,
    price_per_minute: 0.28,
    dispatch_radius_km: 5,
    currency: DEFAULT_CURRENCY,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const fetchConfig = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('companies')
        .select('base_fare, price_per_km, price_per_minute, dispatch_radius_km, currency')
        .eq('id', companyId)
        .maybeSingle();

      if (err) throw err;
      if (data) {
        setConfig({
          base_fare: parseFloat(String(data.base_fare || 0)),
          price_per_km: parseFloat(String(data.price_per_km || 0)),
          price_per_minute: parseFloat(String(data.price_per_minute || 0)),
          dispatch_radius_km: parseFloat(String(data.dispatch_radius_km || 0)),
          currency: data.currency || DEFAULT_CURRENCY,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при зареждане';
      setError(msg);
      console.error('Pricing error:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    if (!companyId) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const { error: err } = await supabase
        .from('companies')
        .update({
          base_fare: config.base_fare,
          price_per_km: config.price_per_km,
          price_per_minute: config.price_per_minute,
          dispatch_radius_km: config.dispatch_radius_km,
          currency: DEFAULT_CURRENCY,
        })
        .eq('id', companyId);

      if (err) throw err;
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при запис';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const setNum = (key: keyof PricingConfig, value: string) => {
    const num = parseFloat(value);
    setConfig((prev) => ({ ...prev, [key]: isNaN(num) ? 0 : num }));
  };

  return (
    <AdminLayout title="Ценова конфигурация">
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
          Настройките са запазени успешно.
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-background-100 p-6">
            <h3 className="font-semibold text-foreground-950 mb-1">Тарифи</h3>
            <p className="text-sm text-foreground-500 mb-6">Тези стойности определят прогнозната цена на пътуване.</p>

            <div className="space-y-5">
              <div>
                <label className="text-sm font-medium text-foreground-700 block mb-1.5">Начална такса ({config.currency})</label>
                <input
                  type="number"
                  step="0.01"
                  value={config.base_fare}
                  onChange={(e) => setNum('base_fare', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground-700 block mb-1.5">Цена на км ({config.currency})</label>
                <input
                  type="number"
                  step="0.01"
                  value={config.price_per_km}
                  onChange={(e) => setNum('price_per_km', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground-700 block mb-1.5">Цена на минута ({config.currency})</label>
                <input
                  type="number"
                  step="0.01"
                  value={config.price_per_minute}
                  onChange={(e) => setNum('price_per_minute', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground-700 block mb-1.5">Радиус за диспечиране (км)</label>
                <input
                  type="number"
                  step="0.5"
                  value={config.dispatch_radius_km}
                  onChange={(e) => setNum('dispatch_radius_km', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
                <p className="text-xs text-foreground-400 mt-1.5">Разстоянието, в което се търсят свободни шофьори.</p>
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-3 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {saving ? t('loading') : t('save')}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-background-100 p-6 h-fit">
            <h3 className="font-semibold text-foreground-950 mb-4">Примерна цена</h3>
            <div className="space-y-3">
              {[3, 8, 15].map((km) => {
                const min = estimateDuration(km);
                const fare = calculateFare({
                  distanceKm: km,
                  durationMin: min,
                  config: {
                    baseFare: config.base_fare,
                    perKm: config.price_per_km,
                    perMin: config.price_per_minute,
                  },
                });
                return (
                  <div key={km} className="flex items-center justify-between bg-background-50 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground-800">{km} км пътуване</p>
                      <p className="text-xs text-foreground-400">≈ {min} мин</p>
                    </div>
                    <span className="text-lg font-bold text-primary-600 font-heading">
                      {fare.total.toFixed(2)} {config.currency}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}