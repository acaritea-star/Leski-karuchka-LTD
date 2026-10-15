// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import { requestGps, stopSharedGps } from '@/lib/sharedGps';
import BookingMap from './BookingMap';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import type { RouteResult } from '@/lib/googleMaps';

vi.mock('@/lib/googleMapsLoader', () => ({ loadGoogleMaps: vi.fn() }));
vi.mock('@/lib/googleMaps', () => ({ decodePolyline: () => [{ lat: 43.35, lng: 25.13 }, { lat: 43.36, lng: 25.14 }] }));
const clearLayer = vi.fn();
const polyline = vi.fn(function () { return { setMap: clearLayer, setPath };  });
const fitBounds = vi.fn();
const panTo = vi.fn();
const markerCreated = vi.fn();
const movePin = vi.fn();
const setPath = vi.fn();
type ResizeCallback = (entries: Pick<ResizeObserverEntry, 'target'>[], observer: ResizeObserver) => void;
const resizeObservers: { notify: ResizeCallback; targets: Element[] }[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  resizeObservers.length = 0;
  vi.mocked(loadGoogleMaps).mockResolvedValue(undefined);
  vi.stubGlobal('google', { maps: {
    Map: class { panTo = panTo; fitBounds = fitBounds; setZoom = vi.fn(); },
    Marker: class { constructor() { markerCreated(); } setMap = clearLayer; setPosition = movePin; setTitle = vi.fn(); }, Polyline: polyline,
    SymbolPath: { FORWARD_CLOSED_ARROW: 1 }, Size: class {}, Point: class {}, LatLngBounds: class { extend = vi.fn(); },
    event: { clearInstanceListeners: vi.fn() },
  } });
  vi.stubGlobal('ResizeObserver', class {
    targets: Element[] = [];
    constructor(notify: ResizeCallback) { resizeObservers.push({ notify, targets: this.targets }); }
    observe = (target: Element) => { this.targets.push(target); };
    disconnect = vi.fn();
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { cleanup(); stopSharedGps(); vi.unstubAllGlobals(); });
const pickup = { address: 'A', lat: 43.35, lng: 25.13 };
const destination = { address: 'B', lat: 43.36, lng: 25.14 };

it('draws only the quoted road route, and removes it as soon as the parent invalidates it', async () => {
  const view = render(<BookingMap pickup={pickup} destination={destination} route={null} />);
  await act(async () => {});
  expect(polyline).not.toHaveBeenCalled();
  view.rerender(<BookingMap pickup={pickup} destination={destination} route={{ polyline: 'quoted' } as RouteResult} />);
  expect(polyline).toHaveBeenCalledTimes(2); // Route + white casing.
  expect(fitBounds).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ top: 94 }));
  view.rerender(<BookingMap pickup={pickup} destination={destination} route={null} />);
  expect(clearLayer).toHaveBeenCalledWith(null);
});

it('offers a map-load retry while keeping booking usable', async () => {
  vi.mocked(loadGoogleMaps).mockRejectedValueOnce(new Error('network'));
  render(<BookingMap pickup={null} destination={null} route={null} />);
  await act(async () => {});
  expect(screen.getByRole('status').textContent).toContain('Картата не се зареди');
  fireEvent.click(screen.getByRole('button', { name: 'Опитай отново' }));
  await act(async () => {});
  expect(loadGoogleMaps).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('status')).toBeNull();
});

it('preserves pins, lines and camera on identical polled coordinates and refreshed prices', async () => {
  const view = render(<BookingMap pickup={pickup} destination={destination} route={{ polyline: 'quoted' } as RouteResult} />);
  await act(async () => {});
  const fits = fitBounds.mock.calls.length;
  view.rerender(<BookingMap pickup={{ ...pickup }} destination={{ ...destination }} route={{ polyline: 'quoted', distance_km: 9 } as RouteResult} />);
  expect(markerCreated).toHaveBeenCalledTimes(2);
  expect(polyline).toHaveBeenCalledTimes(2);
  expect(fitBounds).toHaveBeenCalledTimes(fits);
  expect(clearLayer).not.toHaveBeenCalled();
  view.rerender(<BookingMap pickup={{ ...pickup, lat: 43.351 }} destination={destination} route={null} />);
  expect(markerCreated).toHaveBeenCalledTimes(2);
  expect(movePin).toHaveBeenCalledWith(expect.objectContaining({ lat: 43.351 }));
});

it('never acquires GPS itself and centers once on the shared fix without following later movement', async () => {
  const get = vi.fn((cb: (position: GeolocationPosition) => void) => cb({ timestamp: Date.now(), coords: { latitude: 43.35, longitude: 25.13, accuracy: 10 } } as GeolocationPosition));
  const permission = vi.fn().mockResolvedValue({ state: 'granted' });
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: get }, permissions: { query: permission } });
  render(<BookingMap pickup={null} destination={null} route={null} />);
  await act(async () => {});
  expect(get).not.toHaveBeenCalled(); expect(permission).not.toHaveBeenCalled();
  await act(async () => { await requestGps(); });
  expect(panTo).toHaveBeenCalledWith({ lat: 43.35, lng: 25.13 });
  await act(async () => { await requestGps(); });
  expect(panTo).toHaveBeenCalledTimes(1);
});

it('reserves the route controls and reframes a growing map without rebuilding its layers or following the keyboard',async()=>{
 render(<div className="customer-experience"><header className="customer-header" /><div className="customer-route-controls" />
   <div className="customer-map"><BookingMap pickup={pickup} destination={destination} route={{polyline:'quoted'} as RouteResult} /></div>
   <main className="customer-sheet" /><input aria-label="Търси фирма" /></div>);
 await act(async()=>{});
 const frame=document.querySelector('.customer-map > div') as HTMLElement;
 const controls=document.querySelector('.customer-route-controls')!;
 let height=310;
 Object.defineProperties(frame,{clientWidth:{configurable:true,get:()=>390},clientHeight:{configurable:true,get:()=>height}});
 vi.spyOn(frame,'getBoundingClientRect').mockImplementation(()=>({top:0,left:0,right:390,bottom:height,width:390,height} as DOMRect));
 vi.spyOn(controls,'getBoundingClientRect').mockReturnValue({bottom:142} as DOMRect);
 const observer=resizeObservers.find(o=>o.targets.includes(frame))!;
 const notify=()=>act(()=>observer.notify([{target:frame}],{} as ResizeObserver));
 notify();expect(fitBounds).toHaveBeenLastCalledWith(expect.anything(),{top:154,bottom:26,left:26,right:26});
 height=480;notify();expect(fitBounds).toHaveBeenCalled();
 const fits=fitBounds.mock.calls.length;
 screen.getByRole('textbox').focus();height=250;notify();expect(fitBounds).toHaveBeenCalledTimes(fits);
 screen.getByRole('textbox').blur();notify();expect(fitBounds).toHaveBeenCalledTimes(fits+1);
 expect(loadGoogleMaps).toHaveBeenCalledOnce();expect(markerCreated).toHaveBeenCalledTimes(2);
 expect(polyline).toHaveBeenCalledTimes(2);expect(clearLayer).not.toHaveBeenCalled();
});

it('keeps the route beside the sidebar in desktop and landscape layouts',async()=>{
 render(<div className="customer-experience"><div className="customer-map"><BookingMap pickup={pickup} destination={destination} route={null} /></div><main className="customer-sheet" /></div>);
 await act(async()=>{});
 const frame=document.querySelector('.customer-map > div') as HTMLElement,sheet=document.querySelector('.customer-sheet')!;
 Object.defineProperties(frame,{clientWidth:{configurable:true,value:900},clientHeight:{configurable:true,value:650}});
 vi.spyOn(frame,'getBoundingClientRect').mockReturnValue({left:0,right:900,top:0,bottom:650,width:900,height:650} as DOMRect);
 vi.spyOn(sheet,'getBoundingClientRect').mockReturnValue({left:24,right:432} as DOMRect);
 resizeObservers.find(o=>o.targets.includes(frame))!.notify([{target:frame}],{} as ResizeObserver);
 expect(fitBounds).toHaveBeenLastCalledWith(expect.anything(),{top:32,bottom:32,left:456,right:32});
});
