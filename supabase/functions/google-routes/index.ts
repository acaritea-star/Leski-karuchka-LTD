import { admin, authorize, validPoint } from '../_shared/auth.ts';
import { calculateFare, pricingFromRow, applyVehicleMultiplier } from '../_shared/pricing.ts';
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

  let actor;
  try { actor = await authorize(req); } catch (error) { return error instanceof Response ? error : json({error:'Authentication unavailable'},503); }

  if (!API_KEY) {
    return json({ success: false, error: 'GOOGLE_MAPS_API_KEY not configured' }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const origin = body.origin as { lat?: number; lng?: number } | undefined;
  const destination = body.destination as { lat?: number; lng?: number } | undefined;

  if (!validPoint(origin)) {
    return badRequest('Missing/invalid "origin" { lat, lng }');
  }
  if (!validPoint(destination)) {
    return badRequest('Missing/invalid "destination" { lat, lng }');
  }

  const travelMode = 'DRIVE';
  const language = (body.language as string) || 'bg';
  const units = (body.units as string) || 'METRIC';
  const computeAlternativeRoutes = false;
  if (body.waypoints && (!Array.isArray(body.waypoints) || body.waypoints.length > 5 || !body.waypoints.every(validPoint))) return badRequest('Invalid waypoints');

  const requestBody: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode,
    languageCode: language,
    units,
    computeAlternativeRoutes,
    routingPreference: 'TRAFFIC_AWARE',
  };

  if (body.waypoints && Array.isArray(body.waypoints)) {
    requestBody.intermediates = (body.waypoints as { lat?: number; lng?: number }[]).map((wp) => ({
      location: { latLng: { latitude: wp.lat, longitude: wp.lng } },
    }));
  }

  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(12000),
    });

    const data = await res.json();

    if (!res.ok) {
      return json(
        { success: false, error: data.error?.message || 'Routes API error', details: data.error },
        res.status
      );
    }

    const route = data.routes?.[0];
    if (!route) {
      return json({ success: false, error: 'No route found' }, 404);
    }

    const durationSec = parseInt(String(route.duration || '0').replace('s', ''), 10) || 0;
    const distanceM = route.distanceMeters || 0;

    let quote: Record<string, unknown> = {};
    if (body.quote && typeof body.quote === 'object') {
      if (actor.role !== 'CUSTOMER') return json({error:'Customer account required'},403);
      const options = body.quote as Record<string, unknown>;
      const {data: vehicle, error: vehicleError} = await admin.from('vehicle_types').select('id,company_id,multiplier,is_active').eq('id',options.vehicle_type_id).single();
      if (vehicleError || !vehicle?.is_active) return badRequest('Vehicle type unavailable');
      const {data: company, error: companyError} = await admin.from('companies').select('id,base_fare,price_per_km,price_per_minute,currency,is_active').eq('id',vehicle.company_id).single();
      if (companyError || !company?.is_active || company.currency !== 'EUR') return badRequest('Company unavailable');
      const breakdown = calculateFare({distanceKm: +(distanceM/1000).toFixed(2),durationMin: Math.ceil(durationSec/60),config:applyVehicleMultiplier(pricingFromRow(company),Number(vehicle.multiplier))});
      const {data: saved,error: quoteError} = await admin.from('ride_quotes').insert({customer_id:actor.id,company_id:company.id,vehicle_type_id:vehicle.id,payload:{
        pickup_latitude:origin.lat,pickup_longitude:origin.lng,destination_latitude:destination.lat,destination_longitude:destination.lng,
        pickup_address:String(options.pickup_address ?? '').slice(0,500),destination_address:String(options.destination_address ?? '').slice(0,500),
        distance_km:breakdown.distanceKm,duration_min:breakdown.durationMin,total:breakdown.total,breakdown,
      }}).select('id,expires_at').single();
      if (quoteError || !saved) return json({error:'Could not save quote'},503);
      quote={quote_id:saved.id,quote_expires_at:saved.expires_at,price:breakdown.total,breakdown};
    }
    return json({
      ...quote,
      success: true,
      distance_km: +(distanceM / 1000).toFixed(2),
      duration_min: Math.ceil(durationSec / 60),
      duration_sec: durationSec,
      polyline: route.polyline?.encodedPolyline || '',
      legs: (route.legs || []).map((leg: {distanceMeters:number;duration:string;steps?:Array<{navigationInstruction?:{instructions?:string};distanceMeters?:number;duration?:string}>}) => ({
        distance_meters: leg.distanceMeters,
        duration: leg.duration,
        steps: (leg.steps || []).map((step) => ({
          instruction: step.navigationInstruction?.instructions || '',
          distance_meters: step.distanceMeters,
          duration: step.duration,
        })),
      })),
      alternatives_count: (data.routes || []).length - 1,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Routes API failed';
    return json({ success: false, error: message }, 500);
  }
});
