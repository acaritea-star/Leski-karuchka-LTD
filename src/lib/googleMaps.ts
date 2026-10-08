import { isInBulgaria } from './serviceArea';
import { EdgeRequestError, invokeEdge } from './edgeRequest';
import { metricNow, recordRequestMetric } from './requestMetrics';

// ────────────────────────────────────────────────────────────────────────────
// Google Maps Platform — Frontend wrappers for Supabase Edge Functions
// These call the backend so the GOOGLE_MAPS_API_KEY secret stays server-side.
// ────────────────────────────────────────────────────────────────────────────

export interface GeocodeResult {
  success: boolean;
  lat: number;
  lng: number;
  formatted_address: string;
  place_id: string;
  viewport?: {
    northeast: { lat: number; lng: number };
    southwest: { lat: number; lng: number };
  } | null;
  types?: string[];
  address_components?: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
  error?: string;
}

export interface RouteResult {
  quotes?: Array<{ vehicle_type_id: string; quote_id?: string; quote_expires_at: string; price: number; breakdown: import('@/lib/pricing').FareBreakdown }>;
  quote_id?: string;
  quote_expires_at?: string;
  price?: number;
  breakdown?: import('@/lib/pricing').FareBreakdown;
  success: boolean;
  distance_km: number;
  duration_min: number;
  duration_sec: number;
  polyline: string;
  legs: Array<{
    distance_meters?: number;
    duration?: string;
    steps: Array<{
      instruction: string;
      distance_meters?: number;
      duration?: string;
    }>;
  }>;
  alternatives_count: number;
  error?: string;
  status?: number;
  retry_after_sec?: number;
  code?: string;
}

export interface RoutePoint {
  lat: number;
  lng: number;
}

/** Forward geocode: address → coordinates (via Edge Function) */
export async function geocodeAddress(
  address: string,
  opts?: { region?: string; language?: string }
): Promise<GeocodeResult | null> {
  try {
    const { data, error } = await invokeEdge<GeocodeResult>('google-geocode',
      { address, region: opts?.region ?? 'bg', language: opts?.language ?? 'bg' }, 8000);
    if (error) throw error;
    if (!data?.success) return null;
    return data as GeocodeResult;
  } catch (err) {
    console.error('geocodeAddress error:', err);
    return null;
  }
}

/** Reverse geocode: coordinates → address (via Edge Function) */
export async function reverseGeocode(
  lat: number,
  lng: number,
  opts?: { language?: string; result_type?: string }
): Promise<GeocodeResult | null> {
  try {
    const { data, error } = await invokeEdge<GeocodeResult>('google-geocode',
      { lat, lng, language: opts?.language ?? 'bg', result_type: opts?.result_type }, 8000);
    if (error) throw error;
    if (!data?.success) return null;
    return data as GeocodeResult;
  } catch (err) {
    console.error('reverseGeocode error:', err);
    return null;
  }
}

/** Compute route: origin → destination via Google Routes API (via Edge Function) */
export async function computeRoute(
  origin: RoutePoint,
  destination: RoutePoint,
  opts?: {
    travelMode?: string;
    language?: string;
    units?: string;
    alternatives?: boolean;
    waypoints?: RoutePoint[];
    requestId?: string;
    purpose?: 'pickup' | 'destination' | 'context';
    quote?: { vehicle_type_id: string; pickup_address: string; destination_address: string };
  }
): Promise<RouteResult | null> {
  const started=metricNow();
  if (!isInBulgaria(origin.lat, origin.lng) || !isInBulgaria(destination.lat, destination.lng)
    || opts?.waypoints?.some(point => !isInBulgaria(point.lat, point.lng))) return null;
  try {
    const { data, error } = await invokeEdge<RouteResult>('google-routes', {
        origin,
        destination,
        quote: opts?.quote,
        request_id: opts?.requestId,
        purpose: opts?.purpose,
        travelMode: opts?.travelMode ?? 'DRIVE',
        language: opts?.language ?? 'bg',
        units: opts?.units ?? 'METRIC',
        alternatives: opts?.alternatives ?? false,
        waypoints: opts?.waypoints,
    }, 20_000);
    if (error) throw error;
    recordRequestMetric('route.read',started,data?.success?'ok':'error');
    if (!data?.success) return null;
    return data as RouteResult;
  } catch (err) {
    console.error('computeRoute error:', err);
    recordRequestMetric('route.read',started,'error');
    if (err instanceof EdgeRequestError) return {
      success: false, distance_km: 0, duration_min: 0, duration_sec: 0, polyline: '', legs: [], alternatives_count: 0,
      status: err.status, retry_after_sec: err.retryAfterSeconds, code: err.code, error: err.message,
    };
    return null;
  }
}

/** Decode an encoded Google polyline into a list of {lat,lng} points */
export function decodePolyline(encoded: string): RoutePoint[] {
  const points: RoutePoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}
