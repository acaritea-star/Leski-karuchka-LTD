import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';

export function useSignOut(before?: () => Promise<void>) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const logout = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError('');
    try {
      await before?.();
      await signOut();
      navigate('/');
    } catch {
      setError('Изходът не е потвърден. Провери връзката и опитай отново.');
    } finally { inFlight.current = false; setPending(false); }
  };
  return { logout, pending, error };
}
