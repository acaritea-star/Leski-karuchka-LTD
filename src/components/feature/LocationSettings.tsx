import { driverRecordOptions } from '@/lib/driverRecord';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useLocationPreference } from '@/hooks/useLocationPreference';
import { setLocationEnabled } from '@/lib/locationPreference';
import { getGpsPosition, gpsErrorMessage, requestGps, subscribeGpsState } from '@/lib/sharedGps';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { GPS_STALE_MS, setDriverOnline, stopDriverGps } from '@/lib/driverLocation';
import { queryKeys } from '@/lib/queryKeys';
import { supabase } from '@/lib/supabase';
import { useDriverGps } from './DriverGpsProvider';

export default function LocationSettings({ driver = false, onOffline }: { driver?: boolean; onOffline?: () => void }) {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const en = i18n.language.startsWith('en');
  const enabled = useLocationPreference(user?.id);
  const position = useSyncExternalStore(subscribeGpsState, getGpsPosition, () => null);
  const gps = useDriverGps();
  const client = useQueryClient();
  const { data: record } = useQuery({ ...driverRecordOptions(user?.id), enabled: driver && !!user?.id });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryOffline, setRetryOffline] = useState(false);
  const [, tick] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (enabled !== true) return;
    const timer = setInterval(() => tick(n => n + 1), 5000);
    return () => clearInterval(timer);
  }, [enabled]);
  const offline = async () => {
    if (!user || !driver) return;
    // Read authoritative status even if the profile query is still loading.
    const { data, error: readError } = await withRequestTimeout(signal => supabase.from('drivers').select('*').eq('user_id', user.id)
      .abortSignal(signal).maybeSingle());
    if (readError) throw new Error(readError.message);
    if (data?.is_online) {
      const confirmed = await setDriverOnline(data, false);
      client.setQueryData(queryKeys.driverRecord(user.id), confirmed);
      onOffline?.();
    }
    setRetryOffline(false);
  };
  const toggle = async () => {
    if (!user || busy) return;
    setBusy(true); setError('');
    try {
      if (enabled === true || retryOffline) {
        setLocationEnabled(user.id, false); stopDriverGps();
        try { await offline(); }
        catch (cause) { setRetryOffline(true); throw cause; }
      } else {
        await requestGps();
        if (alive.current) setLocationEnabled(user.id, true);
      }
    } catch (cause) {
      if (alive.current) setError(gpsErrorMessage(cause, en));
    } finally { if (alive.current) setBusy(false); }
  };
  const fresh = position && Date.now() - position.timestamp < GPS_STALE_MS && position.timestamp <= Date.now() + 30_000;
  const status = enabled === false ? (en ? 'Location is off.' : 'Местоположението е изключено.')
    : driver && record?.is_online ? (gps.status === 'tracking' ? (en ? 'Current location confirmed by the server.' : 'Актуална позиция, потвърдена от сървъра.') : gps.error || (en ? 'Waiting for a current position…' : 'Изчакване на актуална позиция…'))
    : fresh ? (en ? 'Current position available.' : 'Има актуална позиция.')
    : position ? (en ? 'The last position is stale.' : 'Последната позиция е остаряла.')
    : en ? 'Location is read when you open the map.' : 'Локацията се прочита при отваряне на картата.';
  return <div className="bg-white rounded-2xl p-4 mt-3 mb-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        <i className="ri-map-pin-line text-foreground-500 text-lg" />
        <div><p className="text-sm font-medium text-foreground-800">{en ? 'Use location automatically' : 'Използвай местоположението автоматично'}</p>
          <p className="text-xs text-foreground-400 mt-1">{en ? 'Saved for this account on this device. Your browser controls GPS permission.' : 'Запомня се за този профил на това устройство. Разрешението за GPS се управлява от браузъра.'}</p>
          {driver && <p className="text-xs text-foreground-400 mt-1">{en ? 'Turning off stops location sharing and takes you offline for new requests. Your active trip stays open.' : 'Изключването спира споделянето и те извежда офлайн за нови заявки. Активният курс остава отворен.'}</p>}
        </div>
      </div>
      <button type="button" role="switch" aria-label={en ? 'Use location automatically' : 'Използвай местоположението автоматично'} aria-checked={enabled === true}
        disabled={busy || retryOffline} onClick={() => void toggle()}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 cursor-pointer ${enabled === true ? 'bg-primary-500' : 'bg-background-300'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200 ${enabled === true ? 'translate-x-5' : ''}`} />
      </button>
    </div>
    <p role="status" className="text-xs text-foreground-500 mt-2">{status}</p>
    {error && <p role="alert" className="text-sm text-red-600 mt-2">{retryOffline ? (en ? 'GPS stopped. Going offline is not yet confirmed by the server. ' : 'GPS е спрян. Извеждането офлайн още не е потвърдено от сървъра. ') : ''}{error}</p>}
    {retryOffline && <button type="button" disabled={busy} onClick={() => void toggle()} className="text-sm text-red-600 underline mt-2">{en ? 'Retry going offline' : 'Повтори извеждането офлайн'}</button>}
  </div>;
}
