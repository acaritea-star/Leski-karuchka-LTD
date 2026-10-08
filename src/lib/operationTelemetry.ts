import { observeRequestMetrics, type RequestSample } from './requestMetrics';
export type MetricRow = { name: RequestSample['name']; outcome: RequestSample['outcome']; count: number; totalMs: number; maxMs: number };
export function startOperationTelemetry(send: (id: string, rows: MetricRow[], signal: AbortSignal) => Promise<boolean>) {
  let rows = new Map<string, MetricRow>(), pending: {id:string;rows:MetricRow[]}|null = null;
  let active = true, busy = false;
  const abort = new AbortController();
  const unsubscribe = observeRequestMetrics(sample => {
    const key = `${sample.name}:${sample.outcome}`;
    const row = rows.get(key) ?? {name:sample.name,outcome:sample.outcome,count:0,totalMs:0,maxMs:0};
    if (row.count >= 1000) return;
    const ms = Math.min(120000,Math.max(0,Math.round(sample.ms)));
    row.count++; row.totalMs+=ms; row.maxMs=Math.max(row.maxMs,ms); rows.set(key,row);
  });
  const flush = async () => {
    if (!active || busy || (!pending && !rows.size) || (typeof document!=='undefined' && document.visibilityState==='hidden')) return;
    if (!pending) { pending={id:crypto.randomUUID(),rows:[...rows.values()]}; rows=new Map(); }
    busy=true;
    try { if (await send(pending.id,pending.rows,abort.signal)) pending=null; } catch { /* Same batch ID on the next minute. */ }
    finally { busy=false; }
  };
  const timer=setInterval(()=>{void flush();},61000);
  return () => {active=false;clearInterval(timer);unsubscribe();abort.abort();rows.clear();pending=null;};
}
