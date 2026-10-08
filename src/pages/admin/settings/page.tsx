import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import { useAuth } from '@/hooks/useAuth';
import { withRequestTimeout } from '@/lib/requestTimeout';
import PrivacyRequests from '@/components/feature/PrivacyRequests';

interface CompanyProfile {
  name: string;
  phone: string;
  email: string;
  address: string;
  legal_name: string;
  registration_id: string;
  permit_number: string;
  permit_expires_on: string;
  document_checks_required: boolean;
  legal_verified_at: string | null;
}

export default function AdminSettings() {
  const { companyId } = useAdminCompany();
  return <SettingsEditor key={companyId ?? 'none'} />;
}

function SettingsEditor() {
  const { t } = useTranslation();
  const { companyId } = useAdminCompany();
  const { user } = useAuth();

  const [profile, setProfile] = useState<CompanyProfile>({
    name: '',
    phone: '',
    email: '',
    address: '',
    legal_name: '', registration_id: '', permit_number: '', permit_expires_on: '', document_checks_required: false, legal_verified_at: null,
  });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const fetchProfile = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    setLoaded(false);
    setError('');
    try {
      const { data, error: err } = await withRequestTimeout(signal => supabase
        .from('companies')
        .select('name, phone, email, address, legal_name, registration_id, permit_number, permit_expires_on, document_checks_required, legal_verified_at')
        .eq('id', companyId)
        .abortSignal(signal).single());

      if (err) throw err;
      if (data) {
        setLoaded(true);
        setProfile({
          name: data.name || '',
          phone: data.phone || '',
          email: data.email || '',
          address: data.address || '',
          legal_name: data.legal_name || '', registration_id: data.registration_id || '', permit_number: data.permit_number || '',
          permit_expires_on: data.permit_expires_on || '', document_checks_required: data.document_checks_required, legal_verified_at: data.legal_verified_at,
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
    if (!companyId || !loaded || savingRef.current || !profile.name.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const { data, error: err } = await withRequestTimeout(signal => supabase
        .from('companies')
        .update({
          name: profile.name.trim(),
          phone: profile.phone.trim(),
          email: profile.email.trim(),
          address: profile.address.trim(),
          legal_name: profile.legal_name.trim() || null, registration_id: profile.registration_id.trim() || null,
          permit_number: profile.permit_number.trim() || null, permit_expires_on: profile.permit_expires_on || null,
          document_checks_required: profile.document_checks_required,
          ...(user?.role === 'SUPER_ADMIN' ? { legal_verified_at: profile.legal_verified_at } : {}),
        })
        .eq('id', companyId).select('legal_verified_at').abortSignal(signal).single());

      if (err) throw err;
      setProfile(prev => ({...prev,legal_verified_at:data?.legal_verified_at ?? null}));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при запис';
      setError(msg);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const setField = (key: keyof CompanyProfile, value: string | boolean | null) =>
    setProfile((prev) => ({ ...prev, [key]: value }));

  return (
    <AdminLayout title={t('nav_settings')}>
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          {!loaded && <button className="underline" onClick={() => void fetchProfile()}>Опитай отново</button>}
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

            {(['legal_name','registration_id','permit_number','permit_expires_on'] as const).map(key => <label key={key} className="block text-sm font-medium text-foreground-700">{{legal_name:'Юридическо име на превозвача',registration_id:'ЕИК на превозвача',permit_number:'Разрешение / регистрация за превоз',permit_expires_on:'Валидно до'}[key]}<input type={key === 'permit_expires_on' ? 'date' : 'text'} maxLength={key==='registration_id'?13:200} value={profile[key]} onChange={e=>setField(key,e.target.value)} className="mt-1 w-full px-4 py-3 rounded-lg border border-background-200 text-sm text-foreground-950"/></label>)}
            <label className="flex gap-2 text-sm text-foreground-700"><input type="checkbox" checked={profile.document_checks_required} onChange={e=>setField('document_checks_required',e.target.checked)}/>Изисквай одобрена книжка и застраховка с валиден срок за нови заявки</label>
            <p className="text-xs text-foreground-500">Известните изтекли срокове се проверяват и без тази настройка. Активен курс може да бъде приключен.</p>
            {user?.role==='SUPER_ADMIN' && <label className="flex gap-2 text-sm text-foreground-700"><input type="checkbox" checked={!!profile.legal_verified_at} onChange={e=>setField('legal_verified_at',e.target.checked?new Date().toISOString():null)}/>Проверих идентичността и валидността на посоченото разрешение</label>}
            <button
              onClick={handleSave}
              disabled={saving || !loaded || !profile.name.trim()}
              className="w-full py-3 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              {saving ? t('loading') : t('save')}
            </button>
          </div>
        </div>
      )}
      {user?.role==='SUPER_ADMIN' && <PrivacyRequests admin/>}
    </AdminLayout>
  );
}
