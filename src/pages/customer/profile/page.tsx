import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import AppMenu from '@/pages/customer/components/AppMenu';

export default function CustomerProfile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, updateProfile } = useAuth();

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    const { error } = await updateProfile({
      first_name: firstName,
      last_name: lastName,
      phone,
    });
    if (error) {
      setSaveError(error.message);
    } else {
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  };

  const initials = `${user?.first_name?.charAt(0) || ''}${user?.last_name?.charAt(0) || ''}`;

  return (
    <div className="min-h-screen bg-background-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl sticky top-0 z-50 border-b border-background-100 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/customer/home')}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-background-100 transition-colors cursor-pointer"
        >
          <i className="ri-arrow-left-line text-foreground-600 text-lg" />
        </button>
        <h1 className="text-lg font-bold text-foreground-950 font-heading flex-1">
          {t('nav_profile')}
        </h1>
        <AppMenu />
      </header>

      <div className="p-4 space-y-4">
        {/* Profile card */}
        <div className="bg-white rounded-2xl p-6 text-center">
          {/* Avatar */}
          <div className="w-20 h-20 rounded-full bg-primary-100 flex items-center justify-center mx-auto mb-3 overflow-hidden">
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <span className="text-2xl font-bold text-primary-600 font-heading">{initials}</span>
            )}
          </div>

          {!editing ? (
            <>
              <h2 className="text-xl font-bold text-foreground-950 font-heading">
                {user?.first_name} {user?.last_name}
              </h2>
              <p className="text-sm text-foreground-500 mt-1">{user?.email}</p>
              {user?.phone && (
                <p className="text-sm text-foreground-400 mt-0.5">{user.phone}</p>
              )}
              <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-background-100 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                <span className="text-xs font-medium text-foreground-600">{t('role_customer')}</span>
              </div>

              <button
                onClick={() => setEditing(true)}
                className="w-full mt-5 py-3 bg-background-100 text-foreground-700 font-medium rounded-xl hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
              >
                {t('edit_profile')}
              </button>
            </>
          ) : (
            <div className="space-y-3 text-left">
              <div>
                <label className="text-xs font-medium text-foreground-500 block mb-1">{t('first_name')}</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground-500 block mb-1">{t('last_name')}</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground-500 block mb-1">{t('phone')}</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all"
                />
              </div>

              {saveError && (
                <p className="text-xs text-red-500">{saveError}</p>
              )}
              {saved && (
                <p className="text-xs text-primary-600">{t('success')}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setEditing(false)}
                  className="flex-1 py-2.5 bg-background-100 text-foreground-600 font-medium rounded-xl hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer text-sm"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 py-2.5 bg-primary-500 text-white font-medium rounded-xl hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer text-sm disabled:opacity-50 shadow-md shadow-primary-500/15"
                >
                  {saving ? t('loading') : t('save')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Trip stats card */}
        <div className="bg-white rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-foreground-700 mb-3 font-heading">{t('statistics')}</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <span className="text-xl font-bold text-foreground-950 font-heading">0</span>
              <span className="text-xs text-foreground-500 block mt-0.5">{t('trips')}</span>
            </div>
            <div className="text-center">
              <span className="text-xl font-bold text-foreground-950 font-heading">—</span>
              <span className="text-xs text-foreground-500 block mt-0.5">{t('rating')}</span>
            </div>
            <div className="text-center">
              <span className="text-xl font-bold text-foreground-950 font-heading">0.00</span>
              <span className="text-xs text-foreground-500 block mt-0.5">{t('lv')} {t('total_spent')}</span>
            </div>
          </div>
        </div>

        <div className="h-8" />
      </div>
    </div>
  );
}