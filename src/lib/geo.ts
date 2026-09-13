// Levski, Pleven Province, Bulgaria — verified town center
// Sources: Bulgarian Wikipedia 43.3592°N 25.1358°E, BulMaps.bg 43.35620°N 25.14040°E, Apple Maps 43.35912°N 25.14128°E
export const LEVSKI_CENTER = { lat: 43.3592, lng: 25.1358 };

export interface LocationPreset {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

// Haversine distance in km
export function calculateDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// Small-town average speed (city baseline — kept for backward compatibility)
export const AVG_SPEED_KMH = 28;

// Smart average speed (km/h) that adapts to trip length.
// Short trips are city driving (slow); long intercity trips use highways.
// Calibrated for Bulgarian roads: city 20-30 km/h, regional 40-55, highway 65-80.
export function smartAverageSpeed(distanceKm: number): number {
  if (distanceKm <= 2) return 20;   // very short, city centre
  if (distanceKm <= 8) return 27;   // city
  if (distanceKm <= 25) return 38;  // city-to-suburb / regional
  if (distanceKm <= 60) return 52;  // regional
  if (distanceKm <= 120) return 65; // intercity, mixed roads
  return 78;                        // long intercity, mostly highway
}

// Estimate duration in minutes using the smart (distance-aware) average speed.
// This is the fallback when the real Google Routes duration is unavailable.
export function estimateDuration(distanceKm: number): number {
  return Math.ceil((distanceKm / smartAverageSpeed(distanceKm)) * 60);
}

// Realistic Levski landmarks (postal code 5900, Pleven Province)
// Coordinates recalibrated against Bulgarian Wikipedia + verified town center
export const LEVSKI_PRESETS: LocationPreset[] = [
  { id: 'center',       name: 'Център',            address: 'пл. Централен, Левски',        lat: 43.35920, lng: 25.13580 },
  { id: 'municipality', name: 'Община Левски',     address: 'бул. България №58, Левски',    lat: 43.35550, lng: 25.14190 },
  { id: 'court',        name: 'Районен съд',       address: 'бул. България №58, Левски',    lat: 43.35510, lng: 25.14150 },
  { id: 'bus-station',  name: 'Автогара',          address: 'Автогара Левски',              lat: 43.34980, lng: 25.13590 },
  { id: 'train-station',name: 'ЖП гара',           address: 'ЖП гара Левски',               lat: 43.34710, lng: 25.14370 },
  { id: 'park',         name: 'Градски парк',      address: 'Градски парк, Левски',         lat: 43.35910, lng: 25.13640 },
  { id: 'stadium',      name: 'Градски стадион',   address: 'Стадион, Левски',              lat: 43.37120, lng: 25.13600 },
  { id: 'medical',      name: 'Медицински център', address: 'Медицински център, Левски',    lat: 43.35380, lng: 25.13790 },
];

// Backward-compatible aliases (older screens may still import the Sofia names)
export const SOFIA_CENTER = LEVSKI_CENTER;
export const SOFIA_PRESETS = LEVSKI_PRESETS;

// National coverage — geographic center of Bulgaria (near Kazanlak).
// Used as the default map center so the app doesn't stay pinned on Levski.
export const BULGARIA_CENTER = { lat: 42.7339, lng: 25.4858 };

// Major Bulgarian cities for quick "city to city" picking across the whole country.
// Coordinates are approximate city centers.
export const BULGARIA_CITIES: LocationPreset[] = [
  { id: 'sofia',          name: 'София',          address: 'София, България',          lat: 42.6977, lng: 23.3219 },
  { id: 'plovdiv',        name: 'Пловдив',        address: 'Пловдив, България',        lat: 42.1354, lng: 24.7453 },
  { id: 'varna',          name: 'Варна',          address: 'Варна, България',          lat: 43.2141, lng: 27.9147 },
  { id: 'burgas',         name: 'Бургас',         address: 'Бургас, България',         lat: 42.5048, lng: 27.4626 },
  { id: 'ruse',           name: 'Русе',           address: 'Русе, България',           lat: 43.8564, lng: 25.9705 },
  { id: 'stara-zagora',   name: 'Стара Загора',   address: 'Стара Загора, България',   lat: 42.4258, lng: 25.6345 },
  { id: 'pleven',         name: 'Плевен',         address: 'Плевен, България',         lat: 43.4170, lng: 24.6067 },
  { id: 'veliko-tarnovo', name: 'Велико Търново', address: 'Велико Търново, България', lat: 43.0757, lng: 25.6172 },
];