import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

interface DriverProfile {
  id: string;
  is_online: boolean;
  rating: number;
  total_trips: number;
  is_verified: boolean;
}

type VehicleInfo = import('@/lib/database.types').Tables<'vehicles'>;

interface DocumentInfo {
  id: string;
  type: string;
  status: string;
  created_at: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  license: 'license',
  id_card: 'id_card',
  insurance: 'insurance',
};

const DOC_STATUS_ICONS: Record<string, string> = {
  pending: 'ri-time-line',
  approved: 'ri-check-double-line',
  rejected: 'ri-close-circle-line',
};

const DOC_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-primary-100 text-primary-700',
  approved: 'bg-accent-100 text-accent-700',
  rejected: 'bg-red-100 text-red-600',
};

export default function DriverProfile() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: driverData } = await supabase
        .from('drivers')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (driverData) {
        setProfile(driverData as DriverProfile);

        // Fetch vehicle if assigned
        if (driverData.vehicle_id) {
          const { data: vehicleData } = await supabase
            .from('vehicles')
            .select('*')
            .eq('id', driverData.vehicle_id)
            .maybeSingle();
          if (vehicleData) setVehicle(vehicleData as VehicleInfo);
        }

        // Fetch documents
        const { data: docsData } = await supabase
          .from('driver_documents')
          .select('*')
          .eq('driver_id', driverData.id)
          .order('created_at', { ascending: false });
        if (docsData) setDocuments(docsData as DocumentInfo[]);
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSignOut = async () => {
    // If driver was online, set offline first
    if (profile?.is_online) {
      await supabase.from('drivers').update({ is_online: false }).eq('id', profile.id);
    }
    await signOut();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background-50">
      <header className="bg-white px-4 py-3 flex items-center gap-3 sticky top-0 z-50">
        <button onClick={() => navigate('/driver/home')} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-background-100 transition-colors cursor-pointer">
          <i className="ri-arrow-left-line text-foreground-600 text-lg" />
        </button>
        <h1 className="text-lg font-bold text-foreground-950 font-heading">{t('nav_profile')}</h1>
      </header>

      <div className="p-4">
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

            {/* Documents Card */}
            <div className="bg-white rounded-2xl p-5 mb-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center">
                  <i className="ri-file-text-line text-foreground-600 text-sm" />
                </div>
                <h3 className="text-sm font-semibold text-foreground-950">{t('driver_documents')}</h3>
              </div>

              {documents.length === 0 ? (
                <p className="text-sm text-foreground-400 text-center py-3">Няма качени документи</p>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <i className={`${DOC_STATUS_ICONS[doc.status] || 'ri-file-line'} text-foreground-500 text-sm`} />
                        <span className="text-sm text-foreground-800">
                          {t(DOC_TYPE_LABELS[doc.type] || doc.type)}
                        </span>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${DOC_STATUS_COLORS[doc.status] || 'bg-background-100 text-foreground-500'}`}>
                        {t(doc.status === 'rejected' ? 'rejected_status' : doc.status)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sign Out */}
            <button
              onClick={handleSignOut}
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