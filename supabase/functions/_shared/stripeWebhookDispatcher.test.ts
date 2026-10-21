import {expect,it,vi} from 'vitest';
import {createStripeWebhookDispatcher} from './stripeWebhookDispatcher';
const request=()=>new Request('https://example.invalid/stripe-webhook',{method:'POST',headers:{'stripe-signature':'signed'},body:'exact raw bytes'});
it('keeps the existing URL and routes only by the independently verified environment',async()=>{
 const sandbox=vi.fn(async(req:Request)=>new Response(await req.text())),live=vi.fn(async()=>new Response('live'));
 const sandboxVerify=vi.fn(async()=>({livemode:false})),liveVerify=vi.fn(async()=>({livemode:true}));
 const handler=createStripeWebhookDispatcher({sandbox,live,sandboxVerify,liveVerify});
 expect(await(await handler(request())).text()).toBe('exact raw bytes');expect(live).not.toHaveBeenCalled();expect(sandboxVerify).toHaveBeenCalledWith('exact raw bytes','signed');
 sandboxVerify.mockRejectedValueOnce(Error('wrong secret'));
 expect(await(await handler(request())).text()).toBe('live');expect(live).toHaveBeenCalledOnce();
});
it('cannot route a signed sandbox event to the live ledger or accept an invalid signature',async()=>{
 const sandbox=vi.fn(),live=vi.fn();
 const handler=createStripeWebhookDispatcher({sandbox,live,sandboxVerify:async()=>({livemode:true}),liveVerify:async()=>{throw Error('bad signature');}});
 expect((await handler(request())).status).toBe(400);expect(sandbox).not.toHaveBeenCalled();expect(live).not.toHaveBeenCalled();
 expect((await handler(new Request('https://example.invalid'))).status).toBe(405);
});
