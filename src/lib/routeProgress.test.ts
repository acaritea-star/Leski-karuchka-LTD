import { expect,it } from 'vitest';
import { remainingRouteEstimate } from './routeProgress';
import { measureRoute } from './routeGeometry';
import type { RouteResult } from './googleMaps';
import type { VehicleFix } from './vehicleMotion';
const road=measureRoute([{lat:43,lng:25},{lat:43,lng:25.01},{lat:43.01,lng:25.01}]);
const info:RouteResult={success:true,distance_km:2,duration_min:20,duration_sec:1200,polyline:'road',legs:[],alternatives_count:0};
const gps=(lat:number,lng:number):VehicleFix=>({lat,lng,timestamp:Date.now(),accuracy:8,speed:5,heading:0});
it('updates remaining distance and ETA along a bend without shortening the route to a straight line',()=>{
 const start=remainingRouteEstimate(info,road,gps(43,25));
 const middle=remainingRouteEstimate(info,road,gps(43,25.005));
 const end=remainingRouteEstimate(info,road,gps(43.01,25.01));
 expect(start).toMatchObject({distanceKm:2,durationMinutes:20});
 expect(middle?.distanceKm).toBeGreaterThan(1.55);expect(middle?.distanceKm).toBeLessThan(1.6);
 expect(middle?.durationMinutes).toBe(16);
 expect(end).toMatchObject({distanceKm:0,durationMinutes:0});
 expect(info.distance_km).toBe(2);expect(info.duration_sec).toBe(1200);
});
it('does not present stale GPS or a different road as an updated route estimate',()=>{
 expect(remainingRouteEstimate(info,road,{...gps(43,25),timestamp:Date.now()-60000})).toBeNull();
 expect(remainingRouteEstimate(info,road,gps(43.005,25.005))).toBeNull();
 expect(remainingRouteEstimate(info,road,{...gps(43,25),accuracy:300})).toBeNull();
});
