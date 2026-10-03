import { expect,it } from 'vitest';
import { RoadNetwork } from './roadNetwork';
import { distanceMetres } from './routeGeometry';
const a={lat:43,lng:25},corner={lat:43.0005,lng:25},b={lat:43.0005,lng:25.0007};
const road = new RoadNetwork([{points:[[a.lat,a.lng],[corner.lat,corner.lng],[b.lat,b.lng]],oneway:0}]);
it('projects an apartment GPS offset onto a nearby street and follows its corner',()=>{
 const start=road.match({...a,lng:a.lng+.0001},0)!;
 const end=road.match(b,90)!;
 expect(distanceMetres(start.point,a)).toBeLessThan(.01);
 expect(road.path(start,end)).toEqual([a,corner,b]);
 expect(start.heading).toBeCloseTo(0);expect(end.heading).toBeCloseTo(90);
});
it('does not invent a street for a GPS point too far from the road',()=>{
 expect(road.match({lat:43.01,lng:25.01})).toBeNull();
});
it('respects one-way direction and avoids connecting separated roads',()=>{
 const network=new RoadNetwork([{points:[[43,25],[43.0005,25]],oneway:1},{points:[[43.0005,25.001],[43.0005,25.0015]],oneway:0}]);
 const start=network.match(a,180)!;
 expect(start.heading).toBe(0);
 expect(network.path(start,network.match({lat:43.0005,lng:25.0012},90)!)).toBeNull();
});
it('uses direction and recent road history to avoid hopping to a parallel street',()=>{
 const network=new RoadNetwork([{points:[[43,25],[43.001,25]],oneway:0},{points:[[43,25.0002],[43.001,25.0002]],oneway:0}]);
 const previous=network.match({lat:43.0002,lng:25},180)!;
 const next=network.match({lat:43.00025,lng:25.00011},180,previous)!;
 expect(next.segmentId).toBe(previous.segmentId);expect(next.heading).toBeCloseTo(180);
});
