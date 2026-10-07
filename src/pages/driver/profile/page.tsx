import { useSignOut } from '@/hooks/useSignOut';
import { withRequestTimeout } from '@/lib/requestTimeout';
import LocationSettings from '@/components/feature/LocationSettings';
import PrivacyRequests from '@/components/feature/PrivacyRequests';
import DriverDocuments from '@/components/feature/DriverDocuments';
import { useQuery } from '@tanstack/react-query';
import { driverRecordOptions } from '@/lib/driverRecord';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export default function DriverProfile() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const profileQuery = useQuery(driverRecordOptions(user?.id));
  const profile = profileQuery.data;
  const loading = profileQuery.isPending;
  const vehicleQuery = useQuery({
    queryKey: ['driver-profile-vehicle', user?.id, profile?.vehicle_id],
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase.from('vehicles').select('*')
        .eq('id', profile!.vehicle_id!).abortSignal(abort).single(), 10_000, signal);
      if (error) throw error;
      return data;
    },
    enabled: !!profile?.vehicle_id,
  });
  const vehicle = vehicleQuery.data;
  const fetchProfile = () => profileQuery.refetch();

  const { logout: handleSignOut, pending: loggingOut, error: logoutError } = useSignOut(async () => {
    if (profile?.is_online) {
      const { error } = await withRequestTimeout(signal => supabase.from('drivers')
        .update({ is_online: false }).eq('id', profile.id).select('id').abortSignal(signal).single());
      if (error) throw error;
    }
  });

  return (
    <div className="min-h-screen bg-background-50">
      <header className="bg-white px-4 py-3 flex items-center gap-3 sticky top-0 z-50">
        <button onClick={() => navigate('/driver/home')} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-background-100 transition-colors cursor-pointer">
          <i className="ri-arrow-left-line text-foreground-600 text-lg" />
        </button>
        <h1 className="text-lg font-bold text-foreground-950 font-heading">{t('nav_profile')}</h1>
      </header>

      <div className="p-4">
        {(profileQuery.isError || vehicleQuery.isError) && <p role="alert" className="mb-3 text-sm text-red-600">Не успяхме да заредим профила или автомобила. <button className="underline" onClick={() => { void profileQuery.refetch(); if (profile?.vehicle_id) void vehicleQuery.refetch(); }}>Опитай отново</button></p>}
        {profile && !profile.is_verified && <p className="mb-3 text-sm text-foreground-600">Профилът очаква верификация. Качи документите си по-долу. Фирмата трябва да ги одобри и да назначи автомобил, преди да получаваш заявки.</p>}
        {logoutError && <p role="alert" className="mb-3 text-sm text-red-600">{logoutError}</p>}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Profile Card */}
            <div className="bg-white rounded-2xl p-6 text-center mb-4">
              <div className="w-20 h-20 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-4 ring-4 ring-background-50">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                ) : (
                  <i className="ri-user-3-line text-3xl text-foreground-400" />
                )}
              </div>
              <h2 className="text-xl font-semibold text-foreground-950 font-heading">
                {user?.first_name} {user?.last_name}
              </h2>
              <p className="text-sm text-foreground-500 mt-0.5">{user?.email}</p>
              <p className="text-sm text-foreground-400 mt-0.5">{user?.phone || '—'}</p>

              {/* Status */}
              <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-background-100">
                <div className="text-center">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${profile?.is_online ? 'bg-accent-500 animate-pulse' : 'bg-foreground-300'}`} />
                    <span className="text-sm font-medium text-foreground-800">
                      {profile?.is_online ? t('you_are_online') : t('you_are_offline')}
                    </span>
                  </div>
                </div>
                <div className="w-px h-5 bg-background-200" />
                <div className="flex items-center gap-1">
                  <i className="ri-star-fill text-primary-500 text-sm" />
                  <span className="text-sm font-semibold text-foreground-800">{parseFloat(String(profile?.rating || 0)).toFixed(1)}</span>
                  <span className="text-xs text-foreground-400">({profile?.total_trips || 0} {t('trips')})</span>
                </div>
                {profile?.is_verified && (
                  <>
                    <div className="w-px h-5 bg-background-200" />
                    <span className="flex items-center gap-1 text-xs text-accent-600 font-medium">
                      <i className="ri-verified-badge-fill" />
                      Верифициран
                    </span>
                  </>
                )}
              </div>
            </div>

            <LocationSettings driver onOffline={() => void fetchProfile()} />
            <PrivacyRequests />

            {/* Vehicle Card */}
            <div className="bg-white rounded-2xl p-5 mb-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center">
                  <i className="ri-car-line text-foreground-600 text-sm" />
                </div>
                <h3 className="text-sm font-semibold text-foreground-950">{t('vehicle')}</h3>
              </div>

              {vehicle ? (
                <div className="space-y-2.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-500">{t('vehicle_make')}</span>
                    <span className="text-foreground-900 font-medium">{vehicle.make}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-500">{t('vehicle_model')}</span>
                    <span className="text-foreground-900 font-medium">{vehicle.model}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-500">{t('vehicle_year')}</span>
                    <span className="text-foreground-900 font-medium">{vehicle.year}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-500">{t('vehicle_color')}</span>
                    <span className="text-foreground-900 font-medium">{vehicle.color}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-500">{t('vehicle_plate')}</span>
                    <span className="text-foreground-900 font-semibold">{vehicle.registration_number}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-500">{t('vehicle_type')}</span>
                    <span className="text-foreground-900 font-medium capitalize">{vehicle.capacity}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-foreground-400 text-center py-3">{t('no_vehicle')}</p>
              )}
            </div>

            {profile && user && <DriverDocuments key={profile.id} driverId={profile.id} userId={user.id} />}

            {/* Sign Out */}
            <button
              onClick={handleSignOut} disabled={loggingOut}
              className="w-full py-3 bg-red-50 text-red-600 font-medium rounded-xl hover:bg-red-100 transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98]"
            >
              {t('logout')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
