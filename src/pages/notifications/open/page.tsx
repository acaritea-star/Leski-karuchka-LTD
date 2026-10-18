import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/contexts/NotificationsContext';
import { beginNotificationLogin } from '@/lib/authReturn';
import { roleHomePath } from '@/lib/roleHome';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export default function NotificationOpen() {
  const { user, loading, profileError, refreshProfile } = useAuth();
  const { companies, setCompanyId, loading: companyLoading } = useAdminCompany();
  const [params] = useSearchParams();
  const id = params.get('id');
  const navigate = useNavigate();
  const { refresh } = useNotifications();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!user || !id || !uuid.test(id)) return;
    if ((user.role === 'COMPANY_ADMIN' || user.role === 'SUPER_ADMIN') && companyLoading) return;
    const controller = new AbortController(); let active = true;
    setError('');
    void withRequestTimeout(signal => supabase.rpc('open_notification', { p_id: id }).abortSignal(signal), 10_000, controller.signal)
      .then(({ data, error }) => {
        if (!active) return;
        if (error || typeof data !== 'string' || !/^\/(customer|driver|admin)\//.test(data) && !data.startsWith('/driver-join?company=')) throw new Error('Unavailable');
        const target = new URL(data, 'https://leskikaruchka.com');
        const company = target.searchParams.get('company');
        if (target.pathname.startsWith('/admin/') && company) {
          if (!uuid.test(company) || !companies.some(row => row.id === company)) throw new Error('Unavailable');
          setCompanyId(company);
        }
        refresh(); navigate(data, { replace: true });
      }).catch(() => { if (active) setError('Известието не е достъпно или връзката прекъсна. Провери профила си и опитай отново.'); });
    return () => { active = false; controller.abort(); };
  }, [user, id, attempt, navigate, refresh, companies, companyLoading, setCompanyId]);
  return <main className="min-h-screen flex items-center justify-center bg-background-50 p-6"><div className="max-w-sm text-center space-y-4">
    <h1 className="text-xl font-semibold">Известие</h1>
    {!id || !uuid.test(id) ? <p role="alert">Невалидно известие.</p>
      : loading ? <p role="status">Зареждане…</p>
      : profileError ? <><p role="alert">Профилът не е достъпен. Провери връзката.</p><button type="button" className="min-h-11 underline" onClick={() => void refreshProfile()}>Опитай отново</button></>
      : !user ? <><p>Влез в профила, за който е предназначено известието.</p><Link to="/auth/login" onClick={() => beginNotificationLogin(id)} className="inline-flex items-center min-h-11 px-5 rounded-xl bg-primary-500 text-white">Към входа</Link></>
      : error ? <><p role="alert">{error}</p><button type="button" className="min-h-11 underline" onClick={() => setAttempt(n => n + 1)}>Опитай отново</button></>
      : <p role="status">Отваряне на известието…</p>}
    <Link className="block min-h-11 underline" to={user ? roleHomePath(user.role) : '/'}>Към приложението</Link>
  </div></main>;
}
