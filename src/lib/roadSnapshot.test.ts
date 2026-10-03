import { beforeEach,afterEach,expect,it,vi } from 'vitest';
let load: typeof import('./roadSnapshot').loadRoadSnapshot;
beforeEach(async()=>{vi.resetModules();vi.stubGlobal('fetch',vi.fn());load=(await import('./roadSnapshot')).loadRoadSnapshot;});
afterEach(()=>vi.unstubAllGlobals());
it('shares a small site-hosted road network throughout Levski without external API calls',async()=>{
 vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({roads:[{points:[[43.35,25.13],[43.351,25.13]],oneway:0}]})));
 const [first,second]=await Promise.all([load({lat:43.35,lng:25.13}),load({lat:43.36,lng:25.14})]);
 expect(first).toBe(second);expect(first?.match({lat:43.35,lng:25.1301})?.point.lng).toBe(25.13);
 expect(fetch).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledWith('/roads/levski.json',expect.objectContaining({signal:expect.anything()}));
});
it('does not use the town snapshot for a driver in another city',async()=>{
 expect(await load({lat:42.6977,lng:23.3219})).toBeNull();expect(fetch).not.toHaveBeenCalled();
});
it('allows a bounded hook retry after a missing static asset instead of caching a failure forever',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce(new Response('missing',{status:404})).mockResolvedValueOnce(new Response(JSON.stringify({roads:[{points:[[43.35,25.13],[43.351,25.13]],oneway:0}]})));
 expect(await load({lat:43.35,lng:25.13})).toBeNull();expect(await load({lat:43.35,lng:25.13})).not.toBeNull();
});
