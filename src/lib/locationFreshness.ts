// Desktop/Wi-Fi providers can measure an idle position only once a minute.
// Keep the actual measurement time: this is a bounded validity window, not a heartbeat.
// Moving vehicles retain the tighter limit; missing speed uses the idle window.
export const MOVING_LOCATION_MS = 45_000;
export const IDLE_LOCATION_MS = 90_000;
export function locationFreshnessMs(speed: number | null | undefined): number {
  return speed != null && (!Number.isFinite(speed) || speed < 0 || speed >= 1.5)
    ? MOVING_LOCATION_MS : IDLE_LOCATION_MS;
}
export function confirmedLocationFresh(receivedAgeMs: number, measuredAgeMs: number, speed: number | null | undefined): boolean {
  const limit = locationFreshnessMs(speed);
  return receivedAgeMs >= -30_000 && measuredAgeMs >= -30_000 && receivedAgeMs < limit && measuredAgeMs < limit;
}
