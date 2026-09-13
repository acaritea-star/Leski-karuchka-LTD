// Shared Web Mercator helpers — used to align SVG overlays (route, markers)
// with non-interactive Google Maps embed iframes (controlled center + zoom).

export const TILE_SIZE = 256;
export const MIN_ZOOM = 11;
export const MAX_ZOOM = 16;

export interface ProjectedPoint {
  x: number;
  y: number;
}

/** Project lat/lng to Web Mercator pixels at a given zoom level. */
export function project(lat: number, lng: number, zoom: number): ProjectedPoint {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const siny = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/** Bearing in degrees (0..360) from one coordinate to another. */
export function bearing(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const f1 = (fromLat * Math.PI) / 180;
  const f2 = (toLat * Math.PI) / 180;
  const dl = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Zoom level that fits a straight-line distance into the given container width. */
export function computeZoom(lat: number, distanceKm: number, widthPx: number): number {
  const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const targetMeters = Math.max(distanceKm * 1000 * 1.7, 1400);
  const zoom = Math.log2((156543.03392 * cosLat * widthPx) / targetMeters);
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)));
}

// `ll` centers the embed WITHOUT drawing an extra red marker —
// all markers are rendered by our own overlay on top of the iframe.
export function buildMapUrl(lat: number, lng: number, zoom: number): string {
  return `https://maps.google.com/maps?ll=${lat.toFixed(6)},${lng.toFixed(6)}&z=${zoom}&output=embed&hl=bg`;
}