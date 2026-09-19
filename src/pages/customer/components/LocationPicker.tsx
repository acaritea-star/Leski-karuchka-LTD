import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocationPreset } from '@/lib/geo';
import { hasPlacesApi, searchPlaces, getPlaceDetails, type PlacePrediction } from '@/lib/places';

interface LocationPickerProps {
  searchQuery: string; onSearchChange: (value: string) => void;
  locating: boolean; locationError: string; recent: LocationPreset[];
  onUseCurrent: () => void; onSelect: (preset: LocationPreset) => void; showCurrentLocation?: boolean;
}

export default function LocationPicker({ searchQuery, onSearchChange, locating, locationError,
  recent, onUseCurrent, onSelect, showCurrentLocation = true }: LocationPickerProps) {
  const { t } = useTranslation();
  const [results, setResults] = useState<PlacePrediction[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const session = useRef(crypto.randomUUID());
  const revision = useRef(0);
  const selection = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const query = searchQuery.trim();
  const enabled = hasPlacesApi();

  useEffect(() => {
    const requestRevision = revision;
    const version = ++requestRevision.current;
    selection.current = false;
    setResolving(null); setResults([]); setError('');
    if (query.length < 2 || !enabled) { setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const predictions = await searchPlaces(query, session.current);
        if (revision.current === version) setResults(predictions);
      } catch {
        if (revision.current === version) setError(t('places_search_error'));
      } finally {
        if (revision.current === version) setSearching(false);
      }
    }, 300);
    return () => { ++requestRevision.current; window.clearTimeout(timer); };
  }, [query, enabled, retry, t]);
  useEffect(() => {
    const lifetime = revision;
    return () => { ++lifetime.current; };
  }, []);

  const choose = (place: LocationPreset) => { input.current?.blur(); onSelect(place); };
  const resolve = async (prediction: PlacePrediction) => {
    if (selection.current || locating) return;
    selection.current = true;
    const version = revision.current;
    setResolving(prediction.place_id); setError('');
    try {
      const place = await getPlaceDetails(prediction.place_id, session.current);
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
      <i className="ri-search-line" aria-hidden="true" />
      <input ref={input} type="search" value={searchQuery} onChange={e => onSearchChange(e.target.value)}
        aria-label={t(showCurrentLocation ? 'pickup_search_title' : 'dest_search_title')}
        placeholder={t('booking_search_hint')} autoComplete="off" spellCheck={false} enterKeyHint="search"
        onKeyDown={e => { if (e.key === 'Escape') { onSearchChange(''); input.current?.blur(); } }} />
      {searchQuery && <button type="button" className="booking-icon-button" aria-label={t('booking_clear')}
        onClick={() => { onSearchChange(''); input.current?.focus(); }}><i className="ri-close-line" aria-hidden="true" /></button>}
    </div>
    <div className="booking-scroll" aria-busy={searching || !!resolving || locating}>
      {showCurrentLocation && !query && <button type="button" className="booking-gps" disabled={locating || !!resolving}
        onClick={onUseCurrent}>
        {locating ? <span className="booking-spinner" /> : <i className="ri-focus-3-line" aria-hidden="true" />}
        <span>{locating ? t('detecting_location') : t('booking_use_gps')}</span>
        <i className="ri-arrow-right-up-line" aria-hidden="true" />
      </button>}
      {locationError && <p className="booking-error" role="alert">{locationError}</p>}
      {error && <div className="booking-error" role="alert"><span>{error}</span>
        <button type="button" onClick={() => setRetry(value => value + 1)}>{t('booking_retry')}</button></div>}
      {query && !enabled && <p className="booking-hint" role="status">{t('booking_search_unavailable')}</p>}
      {query.length === 1 && enabled && <p className="booking-hint">{t('booking_type_more')}</p>}
      {searching && <div className="booking-results-loading" role="status">
        <span className="sr-only">{t('places_searching')}</span>
        <div className="skeleton-line" /><div className="skeleton-line w-3/4" />
      </div>}
      {!searching && query.length >= 2 && enabled && !error && results.length === 0 &&
        <p className="booking-hint" role="status">{t('no_address_found')}</p>}
      {!searching && results.map(place => <button type="button" key={place.place_id} className="booking-place"
        disabled={!!resolving || locating} onClick={() => void resolve(place)}>
        {resolving === place.place_id ? <span className="booking-spinner" /> : <i className="ri-map-pin-2-line" aria-hidden="true" />}
        <span><strong>{place.main_text || place.description}</strong>{place.secondary_text && <small>{place.secondary_text}</small>}</span>
      </button>)}
      {!query && recent.length > 0 && <>
        <p className="booking-recent-label">{t('recent_locations')}</p>
        {recent.slice(0, 3).map(place => <button type="button" key={place.address} className="booking-place"
          disabled={locating || !!resolving} onClick={() => choose(place)}>
          <i className="ri-history-line" aria-hidden="true" />
          <span><strong>{place.name || place.address}</strong>
            {place.name && place.name !== place.address && <small>{place.address}</small>}</span>
          <i className="ri-arrow-right-up-line" aria-hidden="true" />
        </button>)}
      </>}
      {!query && recent.length === 0 && <p className="booking-hint">{t('booking_address_hint')}</p>}
    </div>
  </div>;
}
