import Icon from '@/components/feature/Icon';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isInBulgaria, SERVICE_AREA_ERROR } from '@/lib/serviceArea';
import type { LocationPreset } from '@/lib/geo';
import { hasPlacesApi, searchPlaces, getPlaceDetails, type PlacePrediction } from '@/lib/places';

interface LocationPickerProps {
  searchQuery?: string; onSearchChange?: (value: string) => void;
  locating: boolean; locationError: string; recent: LocationPreset[];
  onUseCurrent: () => void; onSelect: (preset: LocationPreset) => void; showCurrentLocation?: boolean;
  bias?: { lat: number; lng: number };
  resolvingPickup?: boolean;
}

export default function LocationPicker({ searchQuery: controlledQuery, onSearchChange, locating, locationError,
  recent, onUseCurrent, onSelect, showCurrentLocation = true, bias, resolvingPickup = false }: LocationPickerProps) {
  const { t } = useTranslation();
  // Keystrokes belong to this small subtree, keeping the map and booking page
  // out of the input's synchronous render path.
  const [localQuery, setLocalQuery] = useState('');
  const searchQuery = controlledQuery ?? localQuery;
  const changeQuery = (value: string) => { setLocalQuery(value); onSearchChange?.(value); };
  const [results, setResults] = useState<PlacePrediction[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingVisible, setLoadingVisible] = useState(false);
  const [resultQuery, setResultQuery] = useState('');
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const session = useRef(crypto.randomUUID());
  const revision = useRef(0);
  const selection = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const detailsRequest = useRef<AbortController | null>(null);
  const query = searchQuery.trim();
  const enabled = hasPlacesApi();
  const biasLat = bias?.lat, biasLng = bias?.lng;

  useEffect(() => {
    const requestRevision = revision;
    const version = ++requestRevision.current;
    detailsRequest.current?.abort();
    selection.current = false;
    setResolving(null); setError(''); setLoadingVisible(false);
    if (query.length < 2 || !enabled) { setResults([]); setResultQuery(''); setSearching(false); return; }
    setSearching(true);
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => setLoadingVisible(true), 450);
    const timer = window.setTimeout(async () => {
      try {
        const predictions = await searchPlaces(query, session.current, 'bg', controller.signal,
          biasLat == null || biasLng == null ? undefined : { lat: biasLat, lng: biasLng });
        if (revision.current === version) { setResults(predictions); setResultQuery(query); }
      } catch {
        if (revision.current === version) { setResults([]); setError(t('places_search_error')); }
      } finally {
        if (revision.current === version) { setSearching(false); setLoadingVisible(false); window.clearTimeout(loadingTimer); }
      }
    }, 300);
    return () => { ++requestRevision.current; controller.abort(); window.clearTimeout(timer); window.clearTimeout(loadingTimer); };
  }, [query, enabled, retry, showCurrentLocation, biasLat, biasLng, t]);
  useEffect(() => {
    const lifetime = revision;
    return () => { ++lifetime.current; detailsRequest.current?.abort(); };
  }, []);

  const choose = (place: LocationPreset) => { if (!isInBulgaria(place.lat, place.lng)) { setError(SERVICE_AREA_ERROR); return; } session.current = crypto.randomUUID(); input.current?.blur(); onSelect(place); };
  const resolve = async (prediction: PlacePrediction) => {
    if (selection.current || searching || resultQuery !== query) return;
    selection.current = true;
    const version = revision.current;
    const controller = new AbortController();
    detailsRequest.current?.abort();
    detailsRequest.current = controller;
    setResolving(prediction.place_id); setError('');
    const sessionToken = session.current;
    // A details request ends its autocomplete session, including failed or
    // abandoned selections. A new search must start with a new token.
    session.current = crypto.randomUUID();
    try {
      const place = await getPlaceDetails(prediction.place_id, sessionToken, 'bg', controller.signal);
      if (version !== revision.current) return;
      if (place) choose(place); else setError(t('places_search_error'));
    } catch {
      if (version === revision.current) setError(t('places_search_error'));
    } finally {
      if (version === revision.current) { setResolving(null); selection.current = false; }
    }
  };

  return <div className="booking-picker booking-enter">
    <div className="booking-search">
      <Icon name="search" />
      <input ref={input} type="search" value={searchQuery} onChange={e => changeQuery(e.target.value)}
        aria-label={t(showCurrentLocation ? 'pickup_search_title' : 'dest_search_title')}
        placeholder={t('booking_search_hint')} autoComplete="off" spellCheck={false} enterKeyHint="search"
        onKeyDown={e => { if (e.key === 'Escape') { changeQuery(''); input.current?.blur(); } }} />
      {searching && loadingVisible && <span className="booking-spinner" role="status" aria-label={t('places_searching')} />}
      {searchQuery && <button type="button" className="booking-icon-button" aria-label={t('booking_clear')}
        onClick={() => { changeQuery(''); input.current?.focus(); }}><Icon name="close" /></button>}
    </div>
    <div className="booking-scroll" aria-busy={searching || !!resolving || locating}>
      {showCurrentLocation && !query && <button type="button" className="booking-gps" disabled={locating || !!resolving}
        onClick={onUseCurrent}>
        {locating ? <span className="booking-spinner" /> : <Icon name="locate" />}
        <span>{locating ? t('detecting_location') : t('booking_use_gps')}</span>
        <Icon name="arrowUpRight" />
      </button>}
      {locationError && <p className="booking-error" role="alert">{locationError}</p>}
      {resolvingPickup && <p className="booking-hint" role="status">{t('booking_resolving_pickup')}</p>}
      {error && <div className="booking-error" role="alert"><span>{error}</span>
        <button type="button" onClick={() => setRetry(value => value + 1)}>{t('booking_retry')}</button></div>}
      {query && !enabled && <p className="booking-hint" role="status">{t('booking_search_unavailable')}</p>}
      {query.length === 1 && enabled && <p className="booking-hint">{t('booking_type_more')}</p>}
      {searching && loadingVisible && results.length === 0 && <div className="booking-results-loading" role="status">
        <span className="sr-only">{t('places_searching')}</span>
        <div className="skeleton-line" /><div className="skeleton-line w-3/4" />
      </div>}
      {!searching && query.length >= 2 && enabled && !error && results.length === 0 &&
        <p className="booking-hint" role="status">{t('no_address_found')}</p>}
      {results.map(place => <button type="button" key={place.place_id} className="booking-place"
        disabled={!!resolving || searching || resultQuery !== query} onClick={() => void resolve(place)}>
        {resolving === place.place_id ? <span className="booking-spinner" /> : <Icon name="pin" />}
        <span><strong>{place.main_text || place.description}</strong>{place.secondary_text && <small>{place.secondary_text}</small>}</span>
      </button>)}
      {!query && recent.length > 0 && <>
        <p className="booking-recent-label">{t('recent_locations')}</p>
        {recent.slice(0, 3).map(place => <button type="button" key={place.address} className="booking-place"
          disabled={!!resolving} onClick={() => choose(place)}>
          <Icon name="history" />
          <span><strong>{place.name || place.address}</strong>
            {place.name && place.name !== place.address && <small>{place.address}</small>}</span>
          <Icon name="arrowUpRight" />
        </button>)}
      </>}
      {!query && recent.length === 0 && <p className="booking-hint">{t('booking_address_hint')}</p>}
    </div>
    {results.length > 0 && <p className="px-4 py-2 text-xs text-[#5E5E5E] bg-white">
      <span translate="no" className="font-normal not-italic whitespace-nowrap">Google Maps</span>
    </p>}
  </div>;
}
