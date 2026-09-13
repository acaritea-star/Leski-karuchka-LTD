import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';

interface CompanyProfile {
  name: string;
  phone: string;
  email: string;
  address: string;
}

export default function AdminSettings() {
  const { t } = useTranslation();
  const { companyId } = useAdminCompany();

  const [profile, setProfile] = useState<CompanyProfile>({
    name: '',
    phone: '',
    email: '',
    address: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const fetchProfile = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('companies')
        .select('name, phone, email, address')
        .eq('id', companyId)
        .maybeSingle();

      if (err) throw err;
      if (data) {
        setProfile({
          name: data.name || '',
          phone: data.phone || '',
          email: data.email || '',
          address: data.address || '',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при зареждане';
      setError(msg);
      console.error('Settings error:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSave = async () => {
    if (!companyId || !profile.name.trim()) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const { error: err } = await supabase
        .from('companies')
        .update({
          name: profile.name.trim(),
          phone: profile.phone.trim(),
          email: profile.email.trim(),
          address: profile.address.trim(),
        })
        .eq('id', companyId);

      if (err) throw err;
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при запис';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const setField = (key: keyof CompanyProfile, value: string) =>
    setProfile((prev) => ({ ...prev, [key]: value }));

  return (
    <AdminLayout title={t('nav_settings')}>
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          <button onClick={() => setError('')} className="ml-auto w-5 h-5 flex items-center justify-center cursor-pointer">
            <i className="ri-close-line text-red-400 text-xs" />
          </button>
        </div>
      )}

      {saved && (
        <div className="mb-4 bg-primary-50 text-primary-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-check-double-line" />
          Настройките са запазени успешно.
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="max-w-2xl bg-white rounded-2xl border border-background-100 p-6">
          <h3 className="font-semibold text-foreground-950 mb-1">Профил на компанията</h3>
          <p className="text-sm text-foreground-500 mb-6">Тази информация се показва на клиентите и шофьорите.</p>

          <div className="space-y-5">
            <div>
              <label className="text-sm font-medium text-foreground-700 block mb-1.5">Име на компанията</label>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => setField('name', e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground-700 block mb-1.5">Телефон</label>
              <input
                type="text"
                value={profile.phone}
                onChange={(e) => setField('phone', e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground-700 block mb-1.5">Имейл</label>
              <input
                type="email"
                value={profile.email}
                onChange={(e) => setField('email', e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground-700 block mb-1.5">Адрес</label>
              <input
                type="text"
                value={profile.address}
                onChange={(e) => setField('address', e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </div>

            <button
              onClick={handleSave}
              disabled={saving || !profile.name.trim()}
              className="w-full py-3 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              {saving ? t('loading') : t('save')}
            </button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}