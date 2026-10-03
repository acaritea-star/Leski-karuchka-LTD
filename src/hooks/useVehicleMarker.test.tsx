// @vitest-environment jsdom
/* global google */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVehicleMarker } from './useVehicleMarker';
import { RoadNetwork } from '@/lib/roadNetwork';
import { CAR_PATH } from '@/lib/mapLayers';
import type { VehicleFix } from '@/lib/vehicleMotion';

const setPosition = vi.fn(), setIcon = vi.fn(), setMap = vi.fn();
const marker = vi.fn(function () { return { setPosition, setIcon, setMap }; });
const route = [{ lat: 43, lng: 25 }, { lat: 43.0005, lng: 25 }, { lat: 43.0005, lng: 25.0007 }];
const map = {} as google.maps.Map;
const fix = (index = 0): VehicleFix => ({ ...route[index], timestamp: Date.now(), heading: 0, speed: 5, accuracy: 6 });
let media: EventTarget & { matches: boolean };
let visibility = 'visible';
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z')); vi.clearAllMocks();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('google', { maps: { Marker: marker, Point: class {} } });
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 16)));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(clearTimeout));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('creates a car when Maps finishes loading after the initial GPS fix', () => {
  const gps = fix();
  const view = renderHook(({ currentMap }) => useVehicleMarker(currentMap, gps, route), { initialProps: { currentMap: null as google.maps.Map | null } });
  expect(marker).not.toHaveBeenCalled();
  view.rerender({ currentMap: map });
  expect(marker).toHaveBeenCalledOnce();
  expect(marker).toHaveBeenCalledWith(expect.objectContaining({ position: route[0], icon: expect.objectContaining({ path: CAR_PATH, rotation: 0 }) }));
});
it('animates direct Maps frames through a corner and stops at the last received fix', () => {
  const onFrame = vi.fn();
  const view = renderHook(({ gps }) => useVehicleMarker(map, gps, route, undefined, onFrame), { initialProps: { gps: fix() } });
  act(() => vi.advanceTimersByTime(5000));
  view.rerender({ gps: fix(2) });
  act(() => vi.advanceTimersByTime(2000));
  expect(setPosition.mock.lastCall?.[0].lng).toBeCloseTo(route[0].lng, 8);
  expect(setPosition.mock.lastCall?.[0].lat).toBeGreaterThan(route[0].lat);
  act(() => vi.advanceTimersByTime(3100));
  expect(setPosition.mock.lastCall?.[0]).toEqual(route[2]);
  const frames = setPosition.mock.calls.length;
  act(() => vi.advanceTimersByTime(60_000));
  expect(setPosition).toHaveBeenCalledTimes(frames);
  expect(onFrame.mock.lastCall?.[0].moving).toBe(false);
});
it('settles without replay after a hidden tab and cancels frames/listeners on unmount', () => {
  const view = renderHook(({ gps }) => useVehicleMarker(map, gps, route), { initialProps: { gps: fix() } });
  act(() => vi.advanceTimersByTime(5000)); view.rerender({ gps: fix(2) });
  act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  const paused = setPosition.mock.calls.length;
  act(() => vi.advanceTimersByTime(10_000));
  expect(setPosition).toHaveBeenCalledTimes(paused);
  act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  expect(setPosition.mock.lastCall?.[0]).toEqual(route[2]);
  view.unmount();
  expect(setMap).toHaveBeenLastCalledWith(null);
  const frames = setPosition.mock.calls.length;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(5000); });
  expect(setPosition).toHaveBeenCalledTimes(frames);
});
it('honours reduced motion and removes the car if its data source is cleared', () => {
  media.matches = true;
  const view = renderHook(({ gps }) => useVehicleMarker(map, gps, route), { initialProps: { gps: fix() as VehicleFix | null } });
  act(() => vi.advanceTimersByTime(5000)); view.rerender({ gps: fix(2) });
  expect(setPosition.mock.lastCall?.[0]).toEqual(route[2]);
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  view.rerender({ gps: null });
  expect(setMap).toHaveBeenLastCalledWith(null);
});

it('moves the car at frame speed without rebuilding its icon on a straight road', () => {
  const straight = route.slice(0, 2);
  const view = renderHook(({ gps }) => useVehicleMarker(map, gps, straight), { initialProps: { gps: fix() } });
  act(() => vi.advanceTimersByTime(5000));
  view.rerender({ gps: fix(1) });
  act(() => vi.advanceTimersByTime(4000));
  expect(setPosition.mock.calls.length).toBeGreaterThan(100);
  expect(setIcon.mock.calls.length).toBeLessThan(3);
  expect(marker).toHaveBeenCalledTimes(1);
});

it('waits for a reliable road then places the same GPS fix on it without an apartment marker', () => {
  const gps={...fix(),lng:25.0001};
  const roads=new RoadNetwork([{points:route.map(p=>[p.lat,p.lng]),oneway:0}]);
  const view=renderHook(({network})=>useVehicleMarker(map,gps,[],undefined,undefined,network,true),{initialProps:{network:null as RoadNetwork|null}});
  expect(marker).not.toHaveBeenCalled();
  view.rerender({network:roads});
  expect(marker).toHaveBeenCalledWith(expect.objectContaining({position:route[0]}));
});
it('uses navigation geometry before a competing parallel street', () => {
  const roads=new RoadNetwork([{points:[[43,25.0002],[43.0005,25.0002]],oneway:0}]);
  const gps={...fix(),lng:25.00015};
  renderHook(()=>useVehicleMarker(map,gps,route,undefined,undefined,roads,true));
  expect(marker).toHaveBeenCalledWith(expect.objectContaining({position:route[0]}));
});
it('resnaps a delayed calculated route with the existing source timestamp', () => {
  const gps={...fix(),lng:25.0001};
  const view=renderHook(({path})=>useVehicleMarker(map,gps,path),{initialProps:{path:[] as typeof route}});
  expect(marker).toHaveBeenCalledWith(expect.objectContaining({position:expect.objectContaining({lng:gps.lng})}));
  view.rerender({path:route});
  expect(setPosition).toHaveBeenLastCalledWith(route[0]);
});
it('never animates across buildings between unconnected streets', () => {
  const roads=new RoadNetwork([{points:[[43,25],[43.0005,25]],oneway:0},{points:[[43.0005,25.001],[43.0005,25.0015]],oneway:0}]);
  const empty:typeof route=[];
  const view=renderHook(({gps})=>useVehicleMarker(map,gps,empty,undefined,undefined,roads,true),{initialProps:{gps:fix()}});
  act(()=>vi.advanceTimersByTime(15000));
  const next={...fix(),lat:43.0005,lng:25.0012,heading:90};
  view.rerender({gps:next});
  expect(setPosition).toHaveBeenLastCalledWith({lat:next.lat,lng:next.lng});
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});
