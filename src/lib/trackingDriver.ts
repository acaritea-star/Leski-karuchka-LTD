import { queryOptions } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';

export function trackingDriverOptions(userId: string | undefined, requestId: string, driverId: string) {
  return queryOptions({
    // Personal contact data is scoped to this viewer and ride, never just a car.
    queryKey: ['tracking-driver', userId ?? 'none', requestId, driverId],
    enabled: !!userId && !!requestId && !!driverId,
    staleTime: 60_000,
    queryFn: ({ signal }) => withRequestTimeout(async abort => {
      const { data: driver, error } = await supabase.from('drivers')
        .select('user_id, rating, total_trips, vehicle_id').eq('id', driverId).abortSignal(abort).maybeSingle();
      if (error) throw error;
      if (!driver) return null;
      // The profile and assigned vehicle are independent. Embed the vehicle
      // type through its existing FK; ordinary Data API RLS still applies.
      const [profile, vehicle] = await Promise.all([
        supabase.from('profiles').select('first_name, last_name, phone, avatar_url')
          .eq('id', driver.user_id).abortSignal(abort).maybeSingle(),
        driver.vehicle_id ? supabase.from('vehicles')
          .select('make, model, color, registration_number, vehicle_type:vehicle_types!vehicles_vehicle_type_id_fkey(name)')
          .eq('id', driver.vehicle_id).abortSignal(abort).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      if (profile.error) throw profile.error;
      if (vehicle.error) throw vehicle.error;
      const p = profile.data, v = vehicle.data;
      const type = v?.vehicle_type?.name.toLowerCase() ?? '';
      return {
        info: {
          name: [p?.first_name, p?.last_name].filter(Boolean).join(' '),
          phone: p?.phone ?? '', avatar_url: p?.avatar_url ?? null,
          rating: Number(driver.rating ?? 0), total_trips: driver.total_trips ?? 0,
          vehicle_label: v ? [v.make, v.model, v.color, v.registration_number].filter(Boolean).join(' · ') : '',
        },
        vehicleType: type.includes('comfort') ? 'comfort' : type.includes('van') ? 'van' : 'standard',
      };
    }, 10_000, signal, 'tracking.read'),
  });
}
