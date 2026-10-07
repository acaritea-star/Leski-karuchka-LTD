// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {bufferGps,clearGpsBuffer,GPS_BUFFER_TTL,readBufferedGps} from './gpsBuffer';
import {setLocationEnabled} from './locationPreference';
const position=(lat=43.2,timestamp=Date.now())=>({timestamp,coords:{latitude:lat,longitude:25.6,accuracy:10,heading:90,speed:2}} as GeolocationPosition);
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));localStorage.clear();});
afterEach(()=>{localStorage.clear();vi.useRealTimers();});
it('persists just the most recent measured fix across a page restart',()=>{
 bufferGps('user','driver','company',position());vi.advanceTimersByTime(1000);bufferGps('user','driver','company',position(43.3));
 expect(readBufferedGps('user','driver','company')?.coords.latitude).toBe(43.3);expect(localStorage.length).toBe(1);
});
it('discards old or mismatched fixes and never rewrites the measurement timestamp',()=>{
 bufferGps('user','driver','company',position());vi.advanceTimersByTime(GPS_BUFFER_TTL);
 expect(readBufferedGps('user','driver','company')).toBeNull();expect(localStorage.length).toBe(0);
 bufferGps('user','driver','company',position());expect(readBufferedGps('user','other','company')).toBeNull();
 bufferGps('user','driver','company',position());expect(readBufferedGps('user','driver','other')).toBeNull();
});
it('rejects invalid, coarse and far future positions',()=>{
 for(const fix of [position(NaN),position(100),position(43.2,Date.now()+60_000),{...position(),coords:{...position().coords,accuracy:101}}]){
  bufferGps('user','driver','company',fix);expect(readBufferedGps('user','driver','company')).toBeNull();
 }
});
it('clears the optional buffer when sharing is explicitly turned off',()=>{
 bufferGps('user','driver','company',position());setLocationEnabled('user',false);
 expect(readBufferedGps('user','driver','company')).toBeNull();clearGpsBuffer('user');
});
