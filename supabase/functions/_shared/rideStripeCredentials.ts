/** Resolve server-side names without ever exposing credentials to a client.
 * The legacy webhook is assigned only to the environment of its paired key. */
export function resolveRideStripeCredentials(read:(name:string)=>string|undefined) {
 const value=(name:string)=>(read(name)??'').trim();
 const legacy=value('STRIPE_API_KEY'),webhook=value('STRIPE_WEBHOOK_API');
 const legacyLive=/^(sk|rk)_live_/.test(legacy),legacyTest=/^(sk|rk)_test_/.test(legacy);
 return {
  liveKey:value('STRIPE_LIVE_SECRET_KEY')||(legacyLive?legacy:''),
  testKey:legacyTest?legacy:'',
  liveWebhookSecret:value('STRIPE_LIVE_WEBHOOK_SECRET')||(legacyLive?webhook:''),
  testWebhookSecret:legacyTest?webhook:'',
 };
}
