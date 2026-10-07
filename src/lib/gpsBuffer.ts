// One short-lived measured fix. No journey history or fabricated heartbeat.
const PREFIX = 'leski:gps-buffer:';
export const GPS_BUFFER_TTL = 30_000;
type Fix = { driver: string; company: string; timestamp: number; latitude: number; longitude: number; accuracy: number; heading: number | null; speed: number | null };
export function bufferGps(owner: string, driver: string, company: string, position: GeolocationPosition) {
 const {latitude,longitude,accuracy,heading,speed} = position.coords;
 const fix: Fix = {driver,company,timestamp:position.timestamp,latitude,longitude,accuracy,heading,speed};
 try { localStorage.setItem(PREFIX+owner, JSON.stringify(fix)); } catch { /* In-memory latest-fix recovery remains available. */ }
}
export function readBufferedGps(owner: string, driver: string, company: string): GeolocationPosition | null {
 try {
  const raw=localStorage.getItem(PREFIX+owner); if (!raw) return null;
  const p=JSON.parse(raw) as Fix;
  if (p.driver!==driver || p.company!==company || ![p.timestamp,p.latitude,p.longitude,p.accuracy].every(Number.isFinite)
   || p.timestamp>Date.now()+30_000 || Date.now()-p.timestamp>=GPS_BUFFER_TTL || Math.abs(p.latitude)>90 || Math.abs(p.longitude)>180 || p.accuracy<0 || p.accuracy>100) {
   clearGpsBuffer(owner); return null;
  }
  return { timestamp:p.timestamp, coords:{latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy,heading:p.heading,speed:p.speed,altitude:null,altitudeAccuracy:null} } as GeolocationPosition;
 } catch { clearGpsBuffer(owner); return null; }
}
export function clearGpsBuffer(owner: string) { try { localStorage.removeItem(PREFIX+owner); } catch { /* Optional cache. */ } }
