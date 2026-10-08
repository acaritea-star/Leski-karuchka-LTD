export interface Health {
 company_routes?:{quoted:boolean;reserved:number;denied:number}[];
 checked_at:string;stale_online_drivers:number;flagged_rides_24h:number;oldest_push_seconds:number;
 metrics:{name:string;count:number;errors:number;avg_ms:number;max_ms:number}[];
 route_budget:{used:number;daily_limit:number;quote_reserve:number;user_daily_limit:number;ride_limit:number;timezone:string}|null;
}
export function healthAlerts(h:Health) {
 const alerts:string[]=[];
 if(h.stale_online_drivers) alerts.push(`${h.stale_online_drivers} онлайн шофьори без пресен GPS`);
 if(h.oldest_push_seconds>60) alerts.push('Има забавени push известия над 1 минута');
 if(h.flagged_rides_24h) alerts.push(`${h.flagged_rides_24h} курса с GPS сигнали за преглед за последните 24 часа`);
 if(h.route_budget && h.route_budget.used>=h.route_budget.daily_limit*.8) alerts.push('Използвани са поне 80% от дневния бюджет за маршрути');
 for(const m of h.metrics) if(m.count>=20&&m.errors/m.count>.1) alerts.push(`${m.name}: над 10% грешки или изтекли срокове`);
 return alerts;
}
