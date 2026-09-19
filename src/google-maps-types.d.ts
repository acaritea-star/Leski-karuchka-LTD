// Local type declarations for the Google Maps JavaScript API.
//
// These exist because `@types/google.maps` was not reliably resolving in the
// build, which left every `google.maps.*` reference as an undefined global.
// This file declares the subset of the API the app actually uses, as a global
// `google` namespace (matching how the Maps script exposes it at runtime).

declare namespace google {
  namespace maps {
    interface LatLngLiteral {
      lat: number;
      lng: number;
    }

    class Size {
      constructor(width: number, height: number);
    }

    class Point {
      constructor(x: number, y: number);
    }

    interface Icon {
      url: string;
      scaledSize?: Size;
      anchor?: Point;
    }

    const SymbolPath: {
      readonly FORWARD_CLOSED_ARROW: number;
    };

    interface Symbol {
      path: number | string;
      rotation?: number;
      scale?: number;
      fillColor?: string;
      fillOpacity?: number;
      strokeColor?: string;
      strokeWeight?: number;
    }

    class LatLngBounds {
      constructor(sw?: LatLngLiteral, ne?: LatLngLiteral);
      extend(point: LatLngLiteral): LatLngBounds;
      getNorthEast(): { lat(): number; lng(): number };
      getSouthWest(): { lat(): number; lng(): number };
    }

    class Map {
      constructor(el: HTMLElement, opts?: Record<string, unknown>);
      setCenter(center: LatLngLiteral): void;
      setZoom(zoom: number): void;
      panTo(center: LatLngLiteral): void;
      fitBounds(bounds: LatLngBounds, padding?: number | { top?: number; bottom?: number; left?: number; right?: number }): void;
      getBounds(): LatLngBounds | undefined;
      getZoom(): number;
    }

    class Marker {
      constructor(opts?: Record<string, unknown>);
      setMap(map: Map | null): void;
      setPosition(position: LatLngLiteral): void;
      setIcon(icon: Icon | Symbol | null): void;
    }

    class Polyline {
      constructor(opts?: Record<string, unknown>);
      setMap(map: Map | null): void;
      setPath(path: LatLngLiteral[]): void;
    }

    const event: {
      clearInstanceListeners(instance: unknown): void;
    };
  }
}
