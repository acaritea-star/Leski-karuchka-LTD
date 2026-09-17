import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocationPreset } from '@/lib/geo';
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
  showCurrentLocation?: boolean;
}

export default function LocationPicker({
  searchQuery,
  onSearchChange,
  locating,
  locationError,
  recent,
  onUseCurrent,
  onSelect,
  showCurrentLocation = true,
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

  const recentUnique = recent.filter(
    (p, i, arr) => arr.findIndex((x) => x.address === p.address) === i,
  );
  const recentFiltered = trimmed
    ? recentUnique.filter(
        (p) =>
          p.name.toLowerCase().includes(trimmed.toLowerCase()) ||
          p.address.toLowerCase().includes(trimmed.toLowerCase())
      )
    : recentUnique.slice(0, 3);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && googleResults.length > 0) {
      e.preventDefault();
      void selectGooglePlace(googleResults[0]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Search bar (sticky top) */}
      <div className="px-4 pt-2 pb-2 border-b border-background-100 bg-white">
        <div className="relative">
          <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-lg" />
          <input
            type="text"
            placeholder={t('search_placeholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleKeyDown}
            enterKeyHint="search"
            autoComplete="off"
            className="w-full pl-11 pr-11 py-3 bg-background-50 rounded-2xl text-[17px] text-foreground-950 placeholder:text-foreground-500 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all"
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full hover:bg-background-200 transition-colors cursor-pointer"
              aria-label="clear"
            >
              <i className="ri-close-line text-foreground-400 text-lg" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable results */}
      <div className="flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        {/* Use current location (only for pickup, not destination) */}
        {showCurrentLocation && (
          <button
            onClick={onUseCurrent}
            disabled={locating}
            className="w-full flex items-center gap-3 py-3 cursor-pointer text-left disabled:opacity-60 mt-1"
          >
            <span className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center flex-shrink-0">
              {locating ? (
                <span className="w-5 h-5 border-2 border-accent-400 border-t-accent-600 rounded-full animate-spin" />
              ) : (
                <i className="ri-focus-3-line text-accent-600 text-xl" />
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className="text-[16px] font-semibold text-foreground-900 block">
                {locating ? t('detecting_location') : t('use_current_location')}
              </span>
              <span className="text-[14px] text-foreground-500 block truncate">
                {t('current_location_hint')}
              </span>
            </span>
          </button>
        )}

        {locationError && !locating && (
          <p className="text-[14px] text-red-600 flex items-start gap-1.5 my-2 px-1">
            <i className="ri-error-warning-line mt-0.5" />
            {locationError}
          </p>
        )}

        {/* Google Places results (real addresses) */}
        {trimmed && placesEnabled && (
          <div className="mt-1">
            {searchingPlaces ? (
              <div className="flex items-center justify-center gap-2 py-8 text-foreground-500">
                <span className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-[15px]">{t('places_searching')}</span>
              </div>
            ) : placeError ? (
              <div className="text-center py-8">
                <i className="ri-cloud-off-line text-2xl text-foreground-300" />
                <p className="text-[15px] text-foreground-600 mt-2">{placeError}</p>
              </div>
            ) : googleResults.length > 0 ? (
              <div className="space-y-1">
                {googleResults.map((p) => (
                  <button
                    key={p.place_id}
                    onClick={() => selectGooglePlace(p)}
                    className="w-full flex items-center gap-3 py-3 px-1 rounded-xl hover:bg-background-50 transition-colors cursor-pointer text-left"
                  >
                    <span className="w-10 h-10 rounded-lg bg-accent-100 flex items-center justify-center flex-shrink-0">
                      {resolvingId === p.place_id ? (
                        <span className="w-4 h-4 border-2 border-accent-300 border-t-accent-600 rounded-full animate-spin" />
                      ) : (
                        <i className="ri-map-pin-2-line text-accent-600 text-lg" />
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-[16px] font-medium text-foreground-900 block leading-snug truncate">
                        {p.main_text || p.description}
                      </span>
                      {p.secondary_text && (
                        <span className="text-[14px] text-foreground-500 block leading-snug truncate mt-0.5">
                          {p.secondary_text}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <i className="ri-search-line text-2xl text-foreground-300" />
                <p className="text-[15px] text-foreground-600 mt-2">{t('no_address_found')}</p>
              </div>
            )}
          </div>
        )}

        {/* Recent locations (only when not typing) */}
        {!trimmed && recentFiltered.length > 0 && (
          <div className="mt-1">
            <p className="text-[13px] font-semibold text-foreground-500 mb-1.5 px-1">
              {t('recent_locations')}
            </p>
            <div className="space-y-1">
              {recentFiltered.map((preset) => (
                <button
                  key={`recent-${preset.id}-${preset.address}`}
                  onClick={() => onSelect(preset)}
                  className="w-full flex items-center gap-3 py-3 px-1 rounded-xl hover:bg-background-50 transition-colors cursor-pointer text-left"
                >
                  <span className="w-10 h-10 rounded-lg bg-background-100 flex items-center justify-center flex-shrink-0">
                    <i className="ri-time-line text-foreground-500 text-lg" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-[16px] font-medium text-foreground-900 block truncate">
                      {preset.name || preset.address}
                    </span>
                    <span className="text-[14px] text-foreground-500 block truncate">
                      {preset.address}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}