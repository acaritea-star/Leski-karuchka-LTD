import type { LocationPreset } from '@/lib/geo';

// Google Maps Platform API key — injected from the environment (public browser key)
const API_KEY = (import.meta.env.VITE_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) || '';

// National coverage: Bulgaria-wide.
// We bias (not restrict) results toward the country's bounding box, so any
// Bulgarian address — Sofia, Varna, Burgas, Plovdiv, etc. — shows up while
// still allowing border-adjacent places when relevant.
// Bounding box approx: 41.24°N–44.21°N, 22.36°E–28.61°E
const BG_SOUTH_WEST = { latitude: 41.24, longitude: 22.36 };
const BG_NORTH_EAST = { latitude: 44.21, longitude: 28.61 };

export interface PlacePrediction {
  place_id: string;
  description: string;
  main_text?: string;
  secondary_text?: string;
}

export function hasPlacesApi(): boolean {
  const enabled = API_KEY.length > 0;
  
  return enabled;
}

// Places Autocomplete (New) — returns address suggestions as the user types.
// Uses the modern Places API which supports browser (CORS) requests.
export async function searchPlaces(
  query: string,
  sessionToken?: string,
  language = 'bg'
): Promise<PlacePrediction[]> {
  if (!API_KEY || query.trim().length < 2) return [];

  const body: Record<string, unknown> = {
    input: query.trim(),
    languageCode: language,
    regionCode: 'BG',
    locationBias: {
      rectangle: {
        low: BG_SOUTH_WEST,
        high: BG_NORTH_EAST,
      },
    },
  };
  if (sessionToken) body.sessionToken = sessionToken;

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask':
          'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('[places] searchPlaces HTTP error:', res.status, res.statusText);
      throw new Error('Places search unavailable');
    }
    const data = await res.json();
    
    if (!data?.suggestions || !Array.isArray(data.suggestions)) return [];

    return data.suggestions
      .map(
        (entry: {
          placePrediction?: {
            placeId?: string;
            text?: { text?: string };
            structuredFormat?: {
              mainText?: { text?: string };
              secondaryText?: { text?: string };
            };
          };
        }) => {
          const prediction = entry?.placePrediction;
          if (!prediction?.placeId) return null;
          const full = prediction.text?.text ?? '';
          const main = prediction.structuredFormat?.mainText?.text ?? full;
          const secondary = prediction.structuredFormat?.secondaryText?.text ?? '';
          if (!full && !main) return null;
          return {
            place_id: prediction.placeId,
            description: full || `${main}${secondary ? `, ${secondary}` : ''}`,
            main_text: main,
            secondary_text: secondary,
          };
        }
      )
      .filter((p: PlacePrediction | null): p is PlacePrediction => p !== null);
  } catch (error) {
    throw error;
  }
}

// Place Details (New) — resolves a prediction to a precise address + coordinates
export async function getPlaceDetails(
  placeId: string,
  sessionToken?: string,
  language = 'bg'
): Promise<LocationPreset | null> {
  if (!API_KEY) return null;

  const params = new URLSearchParams({ languageCode: language });
  if (sessionToken) params.set('sessionToken', sessionToken);

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${params.toString()}`,
      {
        headers: {
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'id,formattedAddress,location',
        },
      }
    );
    if (!res.ok) {
      console.error('[places] getPlaceDetails HTTP error:', res.status, res.statusText);
      return null;
    }
    const data = await res.json();
    
    const loc = data?.location;
    if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') {
      console.warn('[places] getPlaceDetails — no valid location in response');
      return null;
    }

    const address: string = data.formattedAddress || 'Адрес';
    return {
      id: `gmap-${placeId}`,
      name: address,
      address,
      lat: loc.latitude,
      lng: loc.longitude,
    };
  } catch {
    return null;
  }
}
