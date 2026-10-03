/* global google */
import type { RoutePoint } from './googleMaps';
import { matchRoute, measureRoute, routeSection } from './routeGeometry';

export const MAP_ROUTE_COLOR = '#315943';
export const MAP_PICKUP_COLOR = '#bd8129';
export const MAP_DESTINATION_COLOR = '#19382b';
export const MAP_CAR_COLOR = '#0d9488';

export function mapPinIcon(kind: 'pickup' | 'destination'): google.maps.Icon {
  const color = kind === 'pickup' ? MAP_PICKUP_COLOR : MAP_DESTINATION_COLOR;
  const letter = kind === 'pickup' ? 'A' : 'B';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="48" viewBox="0 0 38 48"><ellipse cx="19" cy="44" rx="7" ry="2" fill="#19382b" opacity=".18"/><path d="M19 44C15 36 3 28 3 18a16 16 0 1 1 32 0c0 10-12 18-16 26Z" fill="${color}" stroke="white" stroke-width="3"/><text x="19" y="24" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="white">${letter}</text></svg>`;
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(38, 48), anchor: new google.maps.Point(19, 44) };
}

// Top-down car, facing north at 0°. SVG path symbols rotate natively in Maps;
// no new bitmap/data URL needs to be decoded on every animation frame.
export const CAR_PATH = 'M-8-18Q-8-21-4-21H4Q8-21 8-18V17Q8 21 4 21H-4Q-8 21-8 17Z M-5-12H5L6-5H-6Z M-6 8H6L5 15H-5Z M-11-12H-9V-4H-11Z M9-12H11V-4H9Z M-11 8H-9V15H-11Z M9 8H11V15H9Z';
export function mapCarSymbol(heading: number, color = MAP_CAR_COLOR): google.maps.Symbol {
  return { path: CAR_PATH, rotation: heading, scale: 1, anchor: new google.maps.Point(0, 0),
    fillColor: color, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 1.8 };
}

export type RouteLine = { setPath: (path: RoutePoint[]) => void; follow: (position: RoutePoint) => void; remove: () => void };
export function drawRouteLine(map: google.maps.Map, path: RoutePoint[], options: {
  color?: string; muted?: boolean; zIndex?: number;
} = {}): RouteLine {
  const color = options.color ?? MAP_ROUTE_COLOR;
  const zIndex = options.zIndex ?? 10;
  const casing = new google.maps.Polyline({ map, path, clickable: false, zIndex,
    strokeColor: '#ffffff', strokeWeight: options.muted ? 5 : 9, strokeOpacity: options.muted ? 0.5 : 0.95 });
  const line = new google.maps.Polyline({ map, path, clickable: false, zIndex: zIndex + 1,
    strokeColor: color, strokeWeight: options.muted ? 3 : 5, strokeOpacity: options.muted ? 0.3 : 1,
    icons: options.muted ? [] : [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      fillColor: '#ffffff', fillOpacity: 1, strokeColor: color, strokeWeight: 1, scale: 2 },
      offset: '60px', repeat: '120px', fixedRotation: false }] });
  let measured = measureRoute(path);
  let lastUpdate = -Infinity;
  let progress: number | undefined;
  let tailIndex: number | undefined;
  const setPath = (next: RoutePoint[]) => { casing.setPath(next); line.setPath(next); };
  return { setPath: next => { measured = measureRoute(next); progress = undefined; tailIndex = undefined; lastUpdate = -Infinity; setPath(next); }, follow: position => {
    const now = performance.now();
    // Keep the car at animation-frame speed; redraw the road at most ten times per second.
    if (now - lastUpdate < 100) return;
    lastUpdate = now;
    const match = matchRoute(position, measured, progress);
    if (!match || match.distance > 35 || (progress != null && Math.abs(match.progress - progress) < .5)) return;
    progress = match.progress;
    let nextTail = match.segment + 1;
    if (progress >= measured.metres[nextTail]) nextTail++;
    const casingPath = casing.getPath?.(), linePath = line.getPath?.();
    if (tailIndex === nextTail && casingPath && linePath) {
      // Within one street segment only the moving head changes. Keep all
      // remaining vertices in Maps instead of copying the full road twice.
      const head = new google.maps.LatLng(match.point.lat, match.point.lng);
      casingPath.setAt(0, head); linePath.setAt(0, head);
    } else setPath(routeSection(measured, progress, measured.length));
    tailIndex = nextTail;
  },
    remove: () => { casing.setMap(null); line.setMap(null); } };
}

// A road refresh changes geometry without detaching its visible map layers.
export type RouteLayerState = { map: google.maps.Map; line: RouteLine; path: RoutePoint[]; style: string };
export function updateRouteLayer(previous: RouteLayerState | null, map: google.maps.Map,
  path: RoutePoint[], options: { color?: string; muted?: boolean; zIndex?: number } = {}): RouteLayerState | null {
  const style = JSON.stringify([options.color, !!options.muted, options.zIndex]);
  if (path.length < 2) { previous?.line.remove(); return null; }
  if (previous && previous.map === map && previous.style === style) {
    if (previous.path !== path) previous.line.setPath(path);
    return { ...previous, path };
  }
  previous?.line.remove();
  return { map, path, style, line: drawRouteLine(map, path, options) };
}
