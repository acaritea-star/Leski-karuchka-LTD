/** Latest phase timings only, kept in this tab's Performance panel. No telemetry,
 * identifiers, keys, URLs, card data or Session secrets are collected. */
export function startRidePaymentTiming(phase:'session'|'script'|'actions'|'card'|'wallet'|'confirm'|'reconcile') {
 const start=typeof performance==='undefined'?null:performance.now();let finished=false;
 return ()=>{
  if(start===null||finished)return;finished=true;
  try {const name=`ride-payment:${phase}`;performance.clearMeasures(name);performance.measure(name,{start,end:performance.now()});}catch{/* Optional browser diagnostics. */}
 };
}
