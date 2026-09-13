import { isFreshTimestamp } from '@/lib/driverLocation';
/* global google */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import { BULGARIA_CENTER } from '@/lib/geo';

interface OnlineDriver {
  id: string;
  first_name: string;
  last_name: string;
  latitude: number;
  longitude: number;
  updated_at: string;
  is_online: boolean;
}

const ONLINE_COLOR = '#0d9488';
const OFFLINE_COLOR = '#9ca3af';

function driverIcon(online: boolean): google.maps.Icon {
  const color = online ? ONLINE_COLOR : OFFLINE_COLOR;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
    `<circle cx="12" cy="12" r="10" fill="${color}" stroke="#ffffff" stroke-width="3"/></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(24, 24),
    anchor: new google.maps.Point(12, 12),
  };
}

export default function AdminMap() {
  const { companyId } = useAdminCompany();
  const [drivers, setDrivers] = useState<OnlineDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDrivers = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      // driver_locations holds the live GPS; drivers holds is_online & user_id
      const { data: locRows, error: locErr } = await supabase
        .from('driver_locations')
        .select('driver_id, latitude, longitude, updated_at')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false });

      if (locErr) throw locErr;

      // Keep only the latest location per driver
      const seen = new Set<string>();
      const latest = (locRows || []).filter((row) => {
        if (seen.has(row.driver_id)) return false;
        seen.add(row.driver_id);
        return true;
      });

      if (latest.length === 0) {
        setDrivers([]);
        return;
      }

      const driverIds = latest.map((d) => d.driver_id);

      const { data: drvRows } = await supabase
        .from('drivers')
        .select('id, user_id, is_online')
        .in('id', driverIds)
        .eq('company_id', companyId);

      const drvMap = (drvRows || []).reduce<Record<string, { user_id: string; is_online: boolean }>>(
        (acc, d) => ({ ...acc, [d.id]: { user_id: d.user_id, is_online: d.is_online } }),
        {}
      );

      const userIds = latest
        .map((d) => drvMap[d.driver_id]?.user_id)
        .filter((uid): uid is string => !!uid);

      let userMap: Record<string, { first_name: string; last_name: string }> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', userIds);
        userMap = (profiles || []).reduce(
          (acc, u) => ({ ...acc, [u.id]: { first_name: u.first_name, last_name: u.last_name } }),
          {}
        );
      }

      const mapped = latest
        .map((loc) => {
          const drv = drvMap[loc.driver_id];
          if (!drv) return null;
          const profile = userMap[drv.user_id];
          return {
            id: loc.driver_id,
            first_name: profile?.first_name || '—',
            last_name: profile?.last_name || '',
            latitude: loc.latitude as number,
            longitude: loc.longitude as number,
            updated_at: loc.updated_at || '',
            is_online: drv.is_online && isFreshTimestamp(loc.updated_at),
          };
        })
        .filter((d): d is OnlineDriver => d !== null);

      setDrivers(mapped);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при зареждане';
      setError(msg);
      console.error('Map error:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchDrivers();
  }, [fetchDrivers]);

  // ── Google Maps (init + marker sync in one pass, runs on every drivers change) ──
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled) return;
        const el = mapContainerRef.current;
        if (!el) return;

        if (!mapRef.current) {
          mapRef.current = new google.maps.Map(el, {
            center: { lat: BULGARIA_CENTER.lat, lng: BULGARIA_CENTER.lng },
            zoom: 7,
            disableDefaultUI: true,
            gestureHandling: 'greedy',
            fullscreenControl: false,
          });
        }
        const map = mapRef.current;

        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];

        if (drivers.length === 0) return;

        const bounds = new google.maps.LatLngBounds();
        drivers.forEach((d) => {
          const pos = { lat: d.latitude, lng: d.longitude };
          bounds.extend(pos);
          const marker = new google.maps.Marker({
            position: pos,
            map,
            icon: driverIcon(d.is_online),
            title: `${d.first_name} ${d.last_name}`,
            zIndex: d.is_online ? 10 : 1,
          });
          markersRef.current.push(marker);
        });
        map.fitBounds(bounds, 50);
      })
      .catch(() => {
        /* map failed to load */
      });

    return () => {
      cancelled = true;
    };
  }, [drivers]);

  const online = drivers.filter((d) => d.is_online);
  const offline = drivers.filter((d) => !d.is_online);

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Току-що';
    if (minutes < 60) return `${minutes} мин`;
    return `${Math.floor(minutes / 60)} ч`;
  };

  return (
    <AdminLayout title="Карта на живо">
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          <button onClick={fetchDrivers} className="ml-auto text-xs font-semibold underline cursor-pointer whitespace-nowrap">
            Опитай отново
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Map */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-background-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-background-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-foreground-950">Левски</h3>
              <p className="text-xs text-foreground-500">
                {online.length} онлайн · {offline.length} офлайн
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-accent-600 bg-accent-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" />
              На живо
            </span>
          </div>
          <div className="h-[440px] relative">
            <div ref={mapContainerRef} className="w-full h-full" />
          </div>
        </div>

        {/* Driver list */}
        <div className="bg-white rounded-2xl border border-background-100 overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-background-100">
            <h3 className="font-semibold text-foreground-950">Шофьори</h3>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[440px]">
            {loading ? (
              <div className="flex justify-center py-16">
                <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : drivers.length === 0 ? (
              <div className="text-center py-16">
                <i className="ri-map-pin-line text-3xl text-foreground-300" />
                <p className="text-sm text-foreground-400 mt-2">Няма шофьори с локация</p>
              </div>
            ) : (
              <div className="divide-y divide-background-100">
                {[...online, ...offline].map((d) => (
                  <div key={d.id} className="px-5 py-3.5 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${d.is_online ? 'bg-accent-100' : 'bg-background-100'}`}>
                      <i className={`ri-user-3-line ${d.is_online ? 'text-accent-600' : 'text-foreground-400'} text-sm`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground-900 truncate">
                        {d.first_name} {d.last_name}
                      </p>
                      <p className="text-xs text-foreground-400 mt-0.5">
                        {d.latitude.toFixed(4)}, {d.longitude.toFixed(4)} · {formatTime(d.updated_at)}
                      </p>
                    </div>
                    <a
                      href={`https://www.google.com/maps?q=${d.latitude},${d.longitude}`}
                      target="_blank"
                      rel="nofollow noopener noreferrer"
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 transition-colors cursor-pointer text-foreground-500 flex-shrink-0"
                      title="Отвори в Google Maps"
                    >
                      <i className="ri-external-link-line text-sm" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}