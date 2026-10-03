/* global google */
import type { RoutePoint } from './googleMaps';
export type ViewPadding = { top: number; bottom: number; left: number; right: number };

// Keep the current scale for nearby address changes. Native panTo animates the
// move; fitBounds is reserved for a route that actually needs a different scale.
export function frameMapPoints(map: google.maps.Map, points: readonly RoutePoint[],
  size: { width: number; height: number }, padding: ViewPadding): 'none' | 'pan' | 'fit' {
  if (!points.length) return 'none';
  let north = -Infinity, south = Infinity, east = -Infinity, west = Infinity;
  for (const point of points) {
    north = Math.max(north, point.lat); south = Math.min(south, point.lat);
    east = Math.max(east, point.lng); west = Math.min(west, point.lng);
  }
  const current = map.getBounds?.();
  const ne = current?.getNorthEast(), sw = current?.getSouthWest();
  const width = size.width, height = size.height;
  if (ne && sw && width > padding.left + padding.right && height > padding.top + padding.bottom) {
    const latSpan = ne.lat() - sw.lat(), lngSpan = ne.lng() - sw.lng();
    const usableNorth = ne.lat() - latSpan * padding.top / height;
    const usableSouth = sw.lat() + latSpan * padding.bottom / height;
    const usableEast = ne.lng() - lngSpan * padding.right / width;
    const usableWest = sw.lng() + lngSpan * padding.left / width;
    if (north <= usableNorth && south >= usableSouth && east <= usableEast && west >= usableWest) return 'none';
    // Include breathing room around the pins. Geographic ratios approximate
    // screen space for these local views; wide routes use Maps' bounds fitting.
    if (north - south < (usableNorth - usableSouth) * .85 && east - west < (usableEast - usableWest) * .85) {
      map.panTo({ lat: (north + south) / 2 + latSpan * (padding.top - padding.bottom) / (2 * height),
        lng: (east + west) / 2 - lngSpan * (padding.left - padding.right) / (2 * width) });
      return 'pan';
    }
  }
  const bounds = new google.maps.LatLngBounds();
  points.forEach(point => bounds.extend(point));
  if (points.length === 1) {
    bounds.extend({ lat: south - .003, lng: west - .003 });
    bounds.extend({ lat: north + .003, lng: east + .003 });
  }
  map.fitBounds(bounds, padding);
  return 'fit';
}
