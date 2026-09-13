import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BULGARIA_CITIES, type LocationPreset } from '@/lib/geo';
import {
  hasPlacesApi,
  searchPlaces,
  getPlaceDetails,
  type PlacePrediction,
} from '@/lib/places';

interface LocationPickerProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  locating: boolean;
  locationError: string;
  recent: LocationPreset[];
  onUseCurrent: () => void;
  onSelect: (preset: LocationPreset) => void;
}

export default function LocationPicker({
  searchQuery,
  onSearchChange,
  locating,
  locationError,
  recent,
  onUseCurrent,
  onSelect,
}: LocationPickerProps) {
  const { t } = useTranslation();

  const [googleResults, setGoogleResults] = useState<PlacePrediction[]>([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);
  const sessionRef = useRef<string>(`${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const trimmed = searchQuery.trim();
  const placesEnabled = hasPlacesApi();

  const popular = trimmed
    ? BULGARIA_CITIES.filter(
        (p) =>
          p.name.toLowerCase().includes(trimmed.toLowerCase()) ||
          p.address.toLowerCase().includes(trimmed.toLowerCase())
      )
    : BULGARIA_CITIES;

  const recentFiltered = trimmed
    ? recent.filter(
        (p) =>
          p.name.toLowerCase().includes(trimmed.toLowerCase()) ||
          p.address.toLowerCase().includes(trimmed.toLowerCase())
      )
    : recent;

  // Debounced Google Places autocomplete search
  useEffect(() => {
    if (!trimmed || !placesEnabled) {
      setGoogleResults([]);
      setSearchingPlaces(false);
      setPlaceError('');
      return;
    }

    setSearchingPlaces(true);
    setPlaceError('');

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const results = await searchPlaces(trimmed, sessionRef.current);
        setGoogleResults(results);
      } catch {
        setGoogleResults([]);
        setPlaceError(t('places_search_error'));
      } finally {
        setSearchingPlaces(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [trimmed, placesEnabled, t]);

  // Resolve a Google prediction to coordinates and hand it to the parent
  const selectGooglePlace = async (prediction: PlacePrediction) => {
    setResolvingId(prediction.place_id);
    try {
      const details = await getPlaceDetails(prediction.place_id, sessionRef.current);
      if (details) {
        onSelect(details);
        setGoogleResults([]);
      } else {
        setPlaceError(t('places_search_error'));
      }
    } finally {
      setResolvingId(null);
    }
  };

  const showPopular =
    !trimmed ||
    !placesEnabled ||
    placeError !== '' ||
    (googleResults.length === 0 && !searchingPlaces);

  return (
    <div className="bg-white rounded-2xl p-4 animate-in fade-in slide-in-from-bottom-4 duration-200">
      {/* Search bar */}
      <div className="relative mb-3">
        <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" />
        <input
          type="text"
          placeholder={t('search_placeholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-9 py-3 bg-background-50 rounded-xl text-sm text-foreground-950 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all"
          autoFocus
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full hover:bg-background-200 transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-foreground-400 text-sm" />
          </button>
        )}
      </div>

      {/* Use current location */}
      <button
        onClick={onUseCurrent}
        disabled={locating}
        className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-accent-50 hover:bg-accent-100 transition-colors cursor-pointer mb-3 text-left disabled:opacity-60"
      >
        <div className="w-10 h-10 rounded-lg bg-accent-500 flex items-center justify-center flex-shrink-0">
          {locating ? (
            <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <i className="ri-focus-3-line text-white text-lg" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-accent-700 block">
            {locating ? t('detecting_location') : t('use_current_location')}
          </span>
          <span className="text-xs text-accent-600/70 block truncate">{t('current_location_hint')}</span>
        </div>
      </button>

      {locationError && !locating && (
        <p className="text-xs text-primary-600 flex items-center gap-1.5 mb-3 px-1">
          <i className="ri-error-warning-line" />
          {locationError}
        </p>
      )}

      {/* Google Places search results (real addresses) */}
      {trimmed && placesEnabled && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2 px-1">
            {t('places_results')}
          </p>

          {searchingPlaces ? (
            <div className="flex items-center justify-center gap-2 py-4 text-foreground-400">
              <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">{t('places_searching')}</span>
            </div>
          ) : placeError ? (
            <div className="text-center py-4">
              <i className="ri-cloud-off-line text-2xl text-foreground-300" />
              <p className="text-sm text-foreground-500 mt-2">{placeError}</p>
            </div>
          ) : googleResults.length > 0 ? (
            <div className="space-y-1 max-h-[240px] overflow-y-auto">
              {googleResults.map((p) => (
                <button
                  key={p.place_id}
                  onClick={() => selectGooglePlace(p)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-background-50 transition-colors cursor-pointer text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-accent-100 flex items-center justify-center flex-shrink-0">
                    {resolvingId === p.place_id ? (
                      <div className="w-4 h-4 border-2 border-accent-300 border-t-accent-600 rounded-full animate-spin" />
                    ) : (
                      <i className="ri-map-pin-2-line text-accent-600 text-base" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground-900 block leading-snug truncate">
                      {p.main_text || p.description}
                    </span>
                    {p.secondary_text && (
                      <span className="text-xs text-foreground-500 block leading-snug truncate mt-0.5">
                        {p.secondary_text}
                      </span>
                    )}
                  </div>
                  {resolvingId !== p.place_id && (
                    <i className="ri-arrow-right-s-line text-foreground-300 text-lg flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-4">
              <i className="ri-search-line text-2xl text-foreground-300" />
              <p className="text-sm text-foreground-500 mt-2">{t('no_results')}</p>
            </div>
          )}
        </div>
      )}

      {/* Recent locations (only when not typing) */}
      {!trimmed && recentFiltered.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2 px-1">
            {t('recent_locations')}
          </p>
          <div className="space-y-1">
            {recentFiltered.map((preset) => (
              <LocationRow key={`recent-${preset.id}-${preset.address}`} preset={preset} onSelect={onSelect} />
            ))}
          </div>
        </div>
      )}

      {/* Popular locations (fallback list, kept for offline / no-query state) */}
      {showPopular && (
        <div className={trimmed ? 'max-h-[260px] overflow-y-auto' : ''}>
          <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2 px-1">
            {t('popular_locations')}
          </p>
          <div className="space-y-1">
            {popular.map((preset) => (
              <LocationRow key={preset.id} preset={preset} onSelect={onSelect} />
            ))}
            {popular.length === 0 && (
              <div className="text-center py-6">
                <i className="ri-map-pin-line text-2xl text-foreground-300" />
                <p className="text-sm text-foreground-500 mt-2">{t('no_results')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LocationRow({
  preset,
  onSelect,
}: {
  preset: LocationPreset;
  onSelect: (preset: LocationPreset) => void;
}) {
  return (
    <button
      onClick={() => onSelect(preset)}
      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-background-50 transition-colors cursor-pointer text-left"
    >
      <div className="w-9 h-9 rounded-lg bg-background-100 flex items-center justify-center flex-shrink-0">
        <i className="ri-map-pin-line text-foreground-500 text-base" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground-900 block truncate">{preset.name}</span>
        <span className="text-xs text-foreground-500 truncate block">{preset.address}</span>
      </div>
    </button>
  );
}