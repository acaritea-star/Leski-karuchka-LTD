import { afterEach, expect, it, vi } from 'vitest';
import { startOperationTelemetry } from './operationTelemetry';
import { metricNow, recordRequestMetric } from './requestMetrics';
afterEach(()=>vi.useRealTimers());
it('batches diagnostics, retries with one ID and stops on logout',async()=>{
 vi.useFakeTimers();const send=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true);
 const stop=startOperationTelemetry(send);
 for(let i=0;i<100;i++) recordRequestMetric('gps.write',metricNow(),'ok');
 expect(send).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(61000);
 expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][1][0].count).toBe(100);
 const id=send.mock.calls[0][0];await vi.advanceTimersByTimeAsync(61000);
 expect(send.mock.calls[1][0]).toBe(id);
 stop();recordRequestMetric('gps.write',metricNow(),'ok');await vi.advanceTimersByTimeAsync(61000);
 expect(send).toHaveBeenCalledTimes(2);expect(send.mock.calls[0][2].aborted).toBe(true);
});
it('does not overlap a hanging batch or send empty heartbeats',async()=>{
 vi.useFakeTimers();const send=vi.fn(()=>new Promise<boolean>(()=>{}));const stop=startOperationTelemetry(send);
 await vi.advanceTimersByTimeAsync(61000);expect(send).not.toHaveBeenCalled();
 recordRequestMetric('ride.create',metricNow(),'timeout');await vi.advanceTimersByTimeAsync(3*61000);
 expect(send).toHaveBeenCalledTimes(1);stop();
});
