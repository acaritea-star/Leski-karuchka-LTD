export interface Health {
 company_routes?:{quoted:boolean;reserved:number;denied:number}[];
 checked_at:string;stale_online_drivers:number;flagged_rides_24h:number;oldest_push_seconds:number;
 metrics:{name:string;count:number;errors:number;avg_ms:number;max_ms:number}[];
 route_budget:{used:number;daily_limit:number;quote_reserve:number;user_daily_limit:number;ride_limit:number;timezone:string}|null;
}
export const operationLabels:Record<string,string>={
 'gps.read':'Показване на локацията','gps.write':'Изпращане на локацията','route.read':'Зареждане на маршрут',
 'ride.create':'Поръчване на такси','ride.accept':'Приемане на заявка','ride.transition':'Обновяване на курс',
 'ride.cancel':'Отказ на заявка','ride.reconcile':'Проверка на заявка','driver.online':'Включване на шофьор',
};
export type HealthNotice={key:string;title:string;detail:string;href?:string;action?:string};
export function healthNotices(h:Health):HealthNotice[] {
 const alerts:HealthNotice[]=[];
 if(h.stale_online_drivers)alerts.push({key:'gps',title:h.stale_online_drivers===1?'1 онлайн шофьор не изпраща актуална локация':`${h.stale_online_drivers} онлайн шофьори не изпращат актуална локация`,detail:'Свържи се с тях. Нека отворят приложението и проверят достъпа до локация и интернет.',href:'/admin/drivers',action:'Отвори шофьорите'});
 if(h.oldest_push_seconds>60)alerts.push({key:'push',title:'Известията се доставят със закъснение',detail:'Има известие, което чака повече от минута. При спешна заявка се свържи с шофьора по телефон.'});
 if(h.flagged_rides_24h)alerts.push({key:'rides',title:`${h.flagged_rides_24h} курса за преглед през последните 24 часа`,detail:'Има непълни или необичайни данни за движението. Това е сигнал за проверка, а не доказателство за нарушение.',href:'/admin/analytics',action:'Отвори курсовете в отчета'});
 if(h.route_budget&&h.route_budget.used>=h.route_budget.daily_limit*.8)alerts.push({key:'routes',title:'Дневният лимит за маршрути наближава',detail:'Използвани са поне 80% от лимита. При изчерпване зареждането на нови маршрути може да бъде ограничено.'});
 for(const m of h.metrics)if(m.count>=20&&m.errors/m.count>.1)alerts.push({key:m.name,title:`${operationLabels[m.name]??'Работа на приложението'}: отчетени затруднения`,detail:`През последните 24 часа ${m.errors} от ${m.count} наблюдавани опита са неуспешни или прекъснати. Това не означава, че проблемът е активен в момента.`});
 return alerts;
}
export function healthAlerts(h:Health){return healthNotices(h).map(a=>a.title);}
