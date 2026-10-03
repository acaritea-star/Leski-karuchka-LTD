// @vitest-environment jsdom
/* global google */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVehicleMarker } from './useVehicleMarker';
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
