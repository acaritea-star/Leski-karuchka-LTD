import {expect,it} from 'vitest';
import {healthAlerts,type Health} from './operationalHealth';
const healthy:Health={checked_at:'2026-10-08',stale_online_drivers:0,flagged_rides_24h:0,oldest_push_seconds:0,metrics:[],route_budget:null};
it('raises observable alerts for a simulated outage, stale GPS, stuck delivery and a depleted budget',()=>{
 const h={...healthy,stale_online_drivers:2,oldest_push_seconds:80,flagged_rides_24h:1,
  metrics:[{name:'ride.create',count:20,errors:8,avg_ms:9000,max_ms:15000}],
  route_budget:{used:100,daily_limit:120,quote_reserve:20,user_daily_limit:60,ride_limit:10,timezone:'America/Los_Angeles'}};
 expect(healthAlerts(h)).toHaveLength(5);expect(healthAlerts(healthy)).toEqual([]);
});
