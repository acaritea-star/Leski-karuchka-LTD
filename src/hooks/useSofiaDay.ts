import { useEffect, useState } from 'react';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' });
export function sofiaDay(now = new Date()) {
  const parts = formatter.formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
// Date changes invalidate the daily cache without adding periodic HTTP reads.
// RPCs still choose their period using the server clock, not this device clock.
export function useSofiaDay() {
  const [day, setDay] = useState(sofiaDay);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') setDay(sofiaDay()); };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh); window.addEventListener('pageshow', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('pageshow', refresh); };
  }, []);
  return day;
}
