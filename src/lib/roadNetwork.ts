import type { RoutePoint } from './googleMaps';
import { distanceMetres, matchRoute, measureRoute, validPoint, type RouteMatch } from './routeGeometry';
import { bearing } from './mapProjection';
export type RoadWay = { points: number[][]; oneway: number };
type Segment = { a: RoutePoint; b: RoutePoint; start: string; end: string; oneway: number };
export type RoadMatch = RouteMatch & { segmentId: number; heading: number };
const nodeKey = (p: RoutePoint) => `${p.lat.toFixed(7)}:${p.lng.toFixed(7)}`;
const cell = (p: RoutePoint) => [Math.floor(p.lat/.002),Math.floor(p.lng/.002)];
const turn = (a: number,b: number) => Math.abs(((a-b+540)%360)-180);
export class RoadNetwork {
 private segments: Segment[]=[];
 private cells=new Map<string,Set<number>>();
 private graph=new Map<string,Array<{ key:string; point:RoutePoint; distance:number }>>();
 constructor(ways: RoadWay[]) {
  const connect=(a:RoutePoint,b:RoutePoint) => {const key=nodeKey(a), edges=this.graph.get(key)??[];edges.push({key:nodeKey(b),point:b,distance:distanceMetres(a,b)});this.graph.set(key,edges);};
  for(const way of ways) for(let i=1;i<way.points.length;i++) {
   const a={lat:way.points[i-1][0],lng:way.points[i-1][1]},b={lat:way.points[i][0],lng:way.points[i][1]};
   if(!validPoint(a)||!validPoint(b)||distanceMetres(a,b)<.1)continue;
   const id=this.segments.length;this.segments.push({a,b,start:nodeKey(a),end:nodeKey(b),oneway:way.oneway});
   if(way.oneway!==-1)connect(a,b);if(way.oneway!==1)connect(b,a);
   const samples=Math.min(100,Math.ceil(distanceMetres(a,b)/100));
   for(let n=0;n<=samples;n++){const [y,x]=cell({lat:a.lat+(b.lat-a.lat)*n/samples,lng:a.lng+(b.lng-a.lng)*n/samples});const key=`${y}:${x}`,ids=this.cells.get(key)??new Set<number>();ids.add(id);this.cells.set(key,ids);}
  }
 }
 match(point: RoutePoint, heading?: number, previous?: RoadMatch): RoadMatch|null {
  const [y,x]=cell(point),ids=new Set<number>();
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)this.cells.get(`${y+dy}:${x+dx}`)?.forEach(id=>ids.add(id));
  let best: RoadMatch|null=null,bestScore=Infinity;
  for(const id of ids){const s=this.segments[id],match=matchRoute(point,measureRoute([s.a,s.b]));if(!match||match.distance>70)continue;
   const direction=bearing(s.a.lat,s.a.lng,s.b.lat,s.b.lng);
   let h=s.oneway===-1?(direction+180)%360:direction;
   if(s.oneway===0&&heading!=null&&turn(h,heading)>90)h=(h+180)%360;
   const score=match.distance+(heading==null?0:Math.min(15,turn(h,heading)/8))+(previous&&previous.segmentId!==id?4:0);
   if(score<bestScore){bestScore=score;best={...match,segmentId:id,heading:h};}
  }
  return best;
 }
 path(from: RoadMatch,to: RoadMatch): RoutePoint[]|null {
  if(from.segmentId===to.segmentId)return [from.point,to.point];
  const source=this.segments[from.segmentId],target=this.segments[to.segmentId];
  const max=Math.min(700,Math.max(80,distanceMetres(from.point,to.point)*2.5));
  const queue:Array<{key:string;distance:number;path:RoutePoint[]}>=[];
  if(source.oneway!==1)queue.push({key:source.start,distance:distanceMetres(from.point,source.a),path:[from.point,source.a]});
  if(source.oneway!==-1)queue.push({key:source.end,distance:distanceMetres(from.point,source.b),path:[from.point,source.b]});
  const visited=new Set<string>();
  for(let n=0;queue.length&&n<400;n++){
   let at=0;for(let i=1;i<queue.length;i++)if(queue[i].distance<queue[at].distance)at=i;
   const item=queue.splice(at,1)[0];if(item.distance>max||visited.has(item.key))continue;visited.add(item.key);
   if(item.key===target.start&&target.oneway!==-1||item.key===target.end&&target.oneway!==1)return [...item.path,to.point];
   for(const edge of this.graph.get(item.key)??[])if(!visited.has(edge.key)&&item.distance+edge.distance<=max)queue.push({key:edge.key,distance:item.distance+edge.distance,path:[...item.path,edge.point]});
  }
  return null;
 }
}
