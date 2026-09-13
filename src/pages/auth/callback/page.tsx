import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export default function AuthCallback() {
  const {user,loading,session} = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && user) navigate('/app',{replace:true}); },[loading,user,navigate]);
  return <main className="min-h-screen flex items-center justify-center p-6 bg-background-50">
    <div role="status" className="max-w-sm text-center">
      {loading ? <p>Завършваме входа…</p> : <>
        <p className="mb-4">{session ? 'Профилът не е достъпен. Опитай отново или се свържи с поддръжката.' : 'Входът не е завършен. Опитай отново.'}</p>
        <a className="underline" href="/auth/login">Към входа</a>
      </>}
    </div>
  </main>;
}
