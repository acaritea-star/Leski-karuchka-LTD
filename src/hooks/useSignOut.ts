import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';

export function useSignOut(before?: () => Promise<void>) {
  const { signOut, user } = useAuth();
  const currentOwner = useRef(user?.id); currentOwner.current = user?.id;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const navigate = useNavigate();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const logout = async () => {
    if (inFlight.current) return;
    const owner = currentOwner.current;
    const active = () => mounted.current && currentOwner.current === owner;
    inFlight.current = true; setPending(true); setError('');
    try {
      await before?.();
      if (!active()) return;
      await signOut();
      if (active()) navigate('/');
    } catch {
      if (active()) setError('Изходът не е потвърден. Провери връзката и опитай отново.');
    } finally { inFlight.current = false; if (active()) setPending(false); }
  };
  return { logout, pending, error };
}
