import { useEffect, useState } from 'react';

// Expire a displayed GPS fix locally; this clock makes no server requests.
export function useFleetClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') setNow(Date.now()); };
    const timer = setInterval(refresh, 5_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return now;
}
