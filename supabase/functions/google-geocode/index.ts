import { authorize } from '../_shared/auth.ts';
const API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function badRequest(message: string): Response {
  return json({ success: false, error: message }, 400);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
      },
    });
  }

  if (req.method !== 'POST') {
    return badRequest('Only POST allowed');
  }

  try { await authorize(req); } catch (error) { return error instanceof Response ? error : new Response('Unavailable',{status:503}); }

  if (!API_KEY) {
    return json({ success: false, error: 'GOOGLE_MAPS_API_KEY not configured' }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  // Forward Geocoding: address → coordinates
  if (body.address && typeof body.address === 'string') {
    const address = body.address as string;
    const region = (body.region as string) || 'bg';

    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('address', address);
      url.searchParams.set('region', region);
      url.searchParams.set('key', API_KEY);
      if (body.language) url.searchParams.set('language', String(body.language));

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
      const data = await res.json();

      if (data.status !== 'OK') {
        return json({ success: false, error: data.status, results: data.results || [] }, 400);
      }

      const result = data.results[0];
      const loc = result?.geometry?.location;
      if (!loc) {
        return json({ success: false, error: 'No location found' }, 404);
      }

      return json({
        success: true,
        lat: loc.lat,
        lng: loc.lng,
        formatted_address: result.formatted_address,
        place_id: result.place_id,
        viewport: result.geometry?.viewport || null,
        types: result.types || [],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Geocoding failed';
      return json({ success: false, error: message }, 500);
    }
  }

  // Reverse Geocoding: coordinates → address
  if (typeof body.lat === 'number' && typeof body.lng === 'number') {
    const lat = body.lat as number;
    const lng = body.lng as number;

    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('latlng', `${lat},${lng}`);
      url.searchParams.set('key', API_KEY);
      if (body.language) url.searchParams.set('language', String(body.language));
      if (body.result_type) url.searchParams.set('result_type', String(body.result_type));

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
      const data = await res.json();

      if (data.status !== 'OK') {
        return json({ success: false, error: data.status, results: data.results || [] }, 400);
      }

      const result = data.results[0];
      const loc = result?.geometry?.location;

      return json({
        success: true,
        lat: loc?.lat ?? lat,
        lng: loc?.lng ?? lng,
        formatted_address: result?.formatted_address || '',
        place_id: result?.place_id || '',
        address_components: result?.address_components || [],
        types: result?.types || [],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Reverse geocoding failed';
      return json({ success: false, error: message }, 500);
    }
  }

  return badRequest('Provide either "address" (string) or "lat"+"lng" (numbers)');
});
