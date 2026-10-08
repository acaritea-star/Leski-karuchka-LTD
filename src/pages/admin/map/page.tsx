/* global google */
import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadFleet, fleetDriverOnline } from '@/lib/adminData';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import { BULGARIA_CENTER } from '@/lib/geo';


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
  return <CompanyMap key={companyId ?? 'none'} />;
}

function CompanyMap() {
  const { companyId, companyName } = useAdminCompany();
  const [, tick] = useState(0);
  const [mapError, setMapError] = useState('');
  const query = useQuery({
    queryKey: ['admin-fleet', companyId],
    queryFn: ({ signal }) => loadFleet(companyId!, signal),
    enabled: !!companyId, refetchInterval: 10_000, refetchOnWindowFocus: true, retry: 1,
  });
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') tick(value => value + 1); }, 5000);
    return () => clearInterval(timer);
  }, []);
  const drivers = (query.data?.rows ?? []).map(driver => ({ ...driver, is_online: fleetDriverOnline(driver) }));
  const loading = query.isLoading;
  const error = mapError || (query.isError ? 'Локациите не се обновиха. Показаните позиции може да са остарели.' : '');
  const fetchDrivers = () => { setMapError(''); void query.refetch(); tick(value => value + 1); };

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef(new Map<string, { marker: google.maps.Marker; lat: number; lng: number; online: boolean; title: string }>());
  const framed = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps().then(() => {
      if (cancelled || !mapContainerRef.current) return;
      const map = mapRef.current ??= new google.maps.Map(mapContainerRef.current, {
        center: BULGARIA_CENTER, zoom: 7, disableDefaultUI: true, gestureHandling: 'greedy', fullscreenControl: false,
      });
      const ids = new Set(drivers.map(driver => driver.id));
      for (const [id, item] of markersRef.current) {
        if (!ids.has(id)) { item.marker.setMap(null); markersRef.current.delete(id); }
      }
      for (const driver of drivers) {
        const title = `${driver.first_name} ${driver.last_name}`.trim();
        const pos = { lat: driver.latitude, lng: driver.longitude };
        const existing = markersRef.current.get(driver.id);
        if (existing) {
          if (existing.lat !== pos.lat || existing.lng !== pos.lng) existing.marker.setPosition(pos);
          if (existing.online !== driver.is_online) existing.marker.setIcon(driverIcon(driver.is_online));
          if (existing.title !== title) existing.marker.setTitle(title);
          Object.assign(existing, { lat: pos.lat, lng: pos.lng, online: driver.is_online, title });
        } else {
          const marker = new google.maps.Marker({ position: pos, map, icon: driverIcon(driver.is_online), title, zIndex: driver.is_online ? 10 : 1 });
          markersRef.current.set(driver.id, { marker, lat: pos.lat, lng: pos.lng, online: driver.is_online, title });
        }
      }
      // Subsequent GPS refreshes must not fight the operator's zoom/pan.
      if (!framed.current && drivers.length) {
        framed.current = true;
        if (drivers.length === 1) { map.setCenter({ lat: drivers[0].latitude, lng: drivers[0].longitude }); map.setZoom(14); }
        else {
          const bounds = new google.maps.LatLngBounds();
          drivers.forEach(driver => bounds.extend({ lat: driver.latitude, lng: driver.longitude }));
          map.fitBounds(bounds, 50);
        }
      }
    }).catch(() => { if (!cancelled) setMapError('Картата не се зареди. Проверете връзката и опитайте отново.'); });
    return () => { cancelled = true; };
  }, [drivers]);
  useEffect(() => {
    const markers = markersRef.current;
    return () => { markers.forEach(item => item.marker.setMap(null)); markers.clear(); };
  }, []);
  const online = drivers.filter(driver => driver.is_online);
  const offline = drivers.filter(driver => !driver.is_online);

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
              <h3 className="font-semibold text-foreground-950">{companyName || 'Автопарк'}</h3>
              <p className="text-xs text-foreground-500">
                {online.length} онлайн · {offline.length} офлайн
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-accent-600 bg-accent-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" />
              {query.isError ? 'Няма актуализация' : 'Обновяване през 10 сек'}
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
      {(query.data?.total ?? 0) > drivers.length && <p className="mt-3 text-xs text-foreground-500">Показани са {drivers.length} от {query.data?.total} шофьори с локация.</p>}
    </AdminLayout>
  );
}
