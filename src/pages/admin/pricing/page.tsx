import { ContentSkeleton } from '@/components/feature/LoadingState';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { isAmbiguousWrite } from '@/lib/rideOperations';
import { estimateDuration } from '@/lib/geo';
import { calculateFare, DEFAULT_CURRENCY } from '@/lib/pricing';

interface PricingConfig {
  base_fare: number;
  min_fare: number;
  price_per_km: number;
  price_per_minute: number;
  dispatch_radius_km: number;
  currency: string;
  night_base_fare: number | null;
  night_price_per_km: number | null;
  night_price_per_minute: number | null;
  night_min_fare: number | null;
}
const nightFields = [ ['night_base_fare', 'Начална такса'], ['night_price_per_km', 'Цена на км'], ['night_price_per_minute', 'Цена на минута от маршрута'], ['night_min_fare', 'Минимална цена'] ] as const;
const emptyNight = { night_base_fare: null, night_price_per_km: null, night_price_per_minute: null, night_min_fare: null };
const readNight = (row: Partial<PricingConfig>) => Object.fromEntries(nightFields.map(([key]) => [key, row[key] == null ? null : Number(row[key])])) as Pick<PricingConfig, keyof typeof emptyNight>;
const pricingColumns = 'id,base_fare,min_fare,price_per_km,price_per_minute,dispatch_radius_km,currency,updated_at,night_base_fare,night_price_per_km,night_price_per_minute,night_min_fare' as const;

export default function AdminPricing() {
  const { companyId } = useAdminCompany();
  return <PricingEditor key={companyId ?? 'none'} />;
}

function PricingEditor() {
  const { t } = useTranslation();
  const { companyId } = useAdminCompany();

  const [config, setConfig] = useState<PricingConfig>({
    base_fare: 2.0,
    min_fare: 0,
    price_per_km: 1.1,
    price_per_minute: 0.28,
    dispatch_radius_km: 5,
    currency: DEFAULT_CURRENCY,
    ...emptyNight,
  });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [blankFields, setBlankFields] = useState<Set<keyof PricingConfig>>(new Set());

  const fetchConfig = useCallback(async () => {
    if (!companyId) { setLoaded(false); setLoading(false); setError('Избери фирма или провери фирмения си достъп.'); return; }
    setLoading(true);
    setLoaded(false);
    setError('');
    try {
      const { data, error: err } = await withRequestTimeout(signal => supabase
        .from('companies')
        .select(pricingColumns)
        .eq('id', companyId)
        .abortSignal(signal).single());

      if (err) throw err;
      if (data) {
        if (!data.updated_at) throw new Error('Версията на тарифите не е заредена. Опитай отново.');
        setVersion(data.updated_at);
        setNeedsReload(false);
        setBlankFields(new Set());
        setLoaded(true);
        setConfig({
          base_fare: parseFloat(String(data.base_fare ?? 0)),
          min_fare: parseFloat(String(data.min_fare ?? 0)),
          price_per_km: parseFloat(String(data.price_per_km || 0)),
          price_per_minute: parseFloat(String(data.price_per_minute || 0)),
          dispatch_radius_km: parseFloat(String(data.dispatch_radius_km || 0)),
          currency: data.currency || DEFAULT_CURRENCY,
          ...readNight(data),
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
    if (!companyId || !loaded || !version || needsReload || savingRef.current) return;
    if (blankFields.size || ![config.base_fare, config.min_fare, config.price_per_km, config.price_per_minute, config.dispatch_radius_km].every(Number.isFinite)
      || config.min_fare < 0 || config.base_fare < 0 || config.price_per_km < 0 || config.price_per_minute < 0 || config.dispatch_radius_km <= 0
      || nightFields.some(([key]) => config[key] !== null && (!Number.isFinite(config[key]) || config[key]! < 0))) {
      setError('Въведи неотрицателни цени и радиус по-голям от нула.'); return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    setSaved(false);
    const submitted = { ...config, currency: DEFAULT_CURRENCY };
    try {
      let data;
      try {
        const reply = await withRequestTimeout(signal => supabase.from('companies').update(submitted)
          .eq('id', companyId).eq('updated_at', version).select(pricingColumns).abortSignal(signal).single());
        if (reply.error) throw reply.error;
        if (!reply.data || reply.data.id !== companyId || !reply.data.updated_at) throw new Error('Записът не е потвърден. Обнови тарифите.');
        data = reply.data;
      } catch (cause) {
        if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'PGRST116') {
          setNeedsReload(true);
          throw new Error('Тарифите са променени или достъпът е променен. Обнови тарифите преди нов запис.');
        }
        if (isAmbiguousWrite(cause)) {
          try {
            // A cancelled HTTP request may already have committed. Confirm the
            // exact submitted values once; never replay an uncertain write.
            const check = await withRequestTimeout(signal => supabase.from('companies').select(pricingColumns)
              .eq('id', companyId).abortSignal(signal).single(), 5000);
            if (!check.error && check.data?.id === companyId && check.data.updated_at && check.data.updated_at !== version
              && Object.entries(submitted).every(([key, value]) => value === null ? check.data![key as keyof PricingConfig] == null : key === 'currency'
                ? check.data!.currency === value : Number(check.data![key as keyof PricingConfig]) === value)) data = check.data;
          } catch { /* Keep the original error if the read cannot confirm it. */ }
        }
        if (!data) { setNeedsReload(true); throw cause; }
      }
      setVersion(data.updated_at);
      setConfig({ base_fare: Number(data.base_fare), min_fare: Number(data.min_fare), price_per_km: Number(data.price_per_km), price_per_minute: Number(data.price_per_minute), dispatch_radius_km: Number(data.dispatch_radius_km), currency: data.currency, ...readNight(data) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при запис';
      setError(msg);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const setNum = (key: keyof PricingConfig, value: string) => {
    const num = value.trim() ? Number(value) : NaN;
    setBlankFields(prev => { const next = new Set(prev); if (!Number.isFinite(num)) next.add(key); else next.delete(key); return next; });
    if (Number.isFinite(num)) setConfig((prev) => ({ ...prev, [key]: num }));
  };

  return (
    <AdminLayout title="Ценова конфигурация">
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          {(!loaded || needsReload) && <button className="underline" disabled={saving} onClick={() => void fetchConfig()}>{needsReload ? 'Обнови тарифите' : 'Опитай отново'}</button>}
          {loaded && !needsReload && <button type="button" aria-label="Затвори съобщението" onClick={() => setError('')} className="ml-auto w-11 h-11 shrink-0 flex items-center justify-center rounded-xl hover:bg-red-100"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
        </div>
      )}

      {saved && (
        <div className="mb-4 bg-primary-50 text-primary-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-check-double-line" />
          Настройките са запазени успешно.
        </div>
      )}

      {loading ? (
        <ContentSkeleton />
      ) : !loaded ? (
        <div className="bg-white border border-background-200 rounded-2xl p-6 text-sm text-foreground-600">Тарифите на фирмата не са заредени. Провери достъпа и опитай отново; цените ще се покажат след потвърдено зареждане.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-background-100 p-6">
            <h3 className="font-semibold text-foreground-950 mb-1">Тарифи</h3>
            <p className="text-sm text-foreground-500 mb-6">Цената се запазва при поръчване. Смята се по метри и секунди, с едно крайно закръгляне до евроцент. Множителят за категорията важи и за минималната цена.</p>

            <fieldset disabled={saving} className="space-y-5">
              <p className="text-sm font-semibold">Основни цени · ден 06:00–22:00</p>
              <div>
                <label htmlFor="admin-pricing-base-fare" className="text-sm font-medium text-foreground-700 block mb-1.5">Начална такса ({config.currency})</label>
                <input id="admin-pricing-base-fare"
                  type="number"
                  step="0.01"
                  value={blankFields.has('base_fare') ? '' : config.base_fare}
                  onChange={(e) => setNum('base_fare', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <div>
                <label htmlFor="admin-pricing-price-per-km" className="text-sm font-medium text-foreground-700 block mb-1.5">Цена на км ({config.currency})</label>
                <input id="admin-pricing-price-per-km"
                  type="number"
                  step="0.01"
                  value={blankFields.has('price_per_km') ? '' : config.price_per_km}
                  onChange={(e) => setNum('price_per_km', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <div>
                <label htmlFor="admin-pricing-price-per-minute" className="text-sm font-medium text-foreground-700 block mb-1.5">Цена на минута от маршрута ({config.currency})</label>
                <input id="admin-pricing-price-per-minute"
                  type="number"
                  step="0.01"
                  value={blankFields.has('price_per_minute') ? '' : config.price_per_minute}
                  onChange={(e) => setNum('price_per_minute', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <div>
                <label htmlFor="minimum-fare" className="text-sm font-medium text-foreground-700 block mb-1.5">Минимална цена ({config.currency})</label>
                <input id="minimum-fare" type="number" min="0" step="0.01" value={blankFields.has('min_fare') ? '' : config.min_fare} onChange={e => setNum('min_fare', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200" />
              </div>
              <div>
                <label htmlFor="admin-pricing-dispatch-radius-km" className="text-sm font-medium text-foreground-700 block mb-1.5">Радиус за диспечиране (км)</label>
                <input id="admin-pricing-dispatch-radius-km"
                  type="number"
                  step="0.5"
                  value={blankFields.has('dispatch_radius_km') ? '' : config.dispatch_radius_km}
                  onChange={(e) => setNum('dispatch_radius_km', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
                <p className="text-xs text-foreground-400 mt-1.5">Разстоянието, в което се търсят свободни шофьори.</p>
              </div>

              <div className="border-t border-background-200 pt-5 space-y-4">
                <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={config.night_base_fare !== null}
                  onChange={e => { const enabled = e.target.checked; setConfig(old => ({ ...old, ...(enabled ? { night_base_fare: old.base_fare, night_price_per_km: old.price_per_km, night_price_per_minute: old.price_per_minute, night_min_fare: old.min_fare } : emptyNight) })); setBlankFields(old => new Set([...old].filter(key => !String(key).startsWith('night_')))); }} />Отделни нощни цени · 22:00–06:00</label>
                <p className="text-xs text-foreground-500">Часовете са по българско време. При изключена опция основните цени важат денонощно. „Минута от маршрута“ включва времето в движение; това не е отделна такса за престой.</p>
                {config.night_base_fare !== null && <div className="grid sm:grid-cols-2 gap-4">{nightFields.map(([key, label]) => <label key={key} className="text-sm font-medium text-foreground-700">{label} — нощ ({config.currency})<input type="number" min="0" step="0.01" value={blankFields.has(key) ? '' : config[key] ?? ''} onChange={e => setNum(key, e.target.value)} className="block w-full mt-1 px-4 py-3 rounded-lg border border-background-200 text-foreground-950" /></label>)}</div>}
              </div>
              <button
                onClick={handleSave}
                disabled={saving || !loaded || needsReload}
                className="w-full py-3 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {saving ? t('loading') : t('save')}
              </button>
            </fieldset>
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
                    minFare: config.min_fare,
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
