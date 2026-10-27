import { expect,it } from 'vitest';
import { resolveRideStripeCredentials } from './rideStripeCredentials';
const resolve=(values:Record<string,string>)=>resolveRideStripeCredentials(name=>values[name]);
it('supports the existing generic names when both credentials belong to live operation',()=>{
 expect(resolve({STRIPE_API_KEY:'sk_live_fixture',STRIPE_WEBHOOK_API:'whsec_fixtureLive'})).toEqual({liveKey:'sk_live_fixture',testKey:'',liveWebhookSecret:'whsec_fixtureLive',testWebhookSecret:''});
});
it.each(['sk_test_fixture','rk_test_fixture'])('never uses a legacy test webhook for live settlement with %s',key=>{
 expect(resolve({STRIPE_API_KEY:key,STRIPE_WEBHOOK_API:'whsec_fixtureTest',STRIPE_LIVE_SECRET_KEY:'sk_live_fixture'})).toEqual({liveKey:'sk_live_fixture',testKey:key,liveWebhookSecret:'',testWebhookSecret:'whsec_fixtureTest'});
});
it('keeps separately configured test and live signing secrets independent',()=>{
 expect(resolve({STRIPE_API_KEY:'sk_test_fixture',STRIPE_WEBHOOK_API:'whsec_fixtureTest',STRIPE_LIVE_SECRET_KEY:'sk_live_fixture',STRIPE_LIVE_WEBHOOK_SECRET:'whsec_fixtureLive'})).toEqual({liveKey:'sk_live_fixture',testKey:'sk_test_fixture',liveWebhookSecret:'whsec_fixtureLive',testWebhookSecret:'whsec_fixtureTest'});
});
it('does not silently replace a nonempty explicit live key with another credential',()=>{
 expect(resolve({STRIPE_API_KEY:'sk_live_fixture',STRIPE_LIVE_SECRET_KEY:'sk_test_wrong'}).liveKey).toBe('sk_test_wrong');
});
it('prefers an explicit live signing secret over the legacy alias',()=>{
 expect(resolve({STRIPE_API_KEY:'sk_live_fixture',STRIPE_WEBHOOK_API:'whsec_old',STRIPE_LIVE_WEBHOOK_SECRET:'whsec_new'}).liveWebhookSecret).toBe('whsec_new');
});
it('normalizes surrounding whitespace and treats empty optional values as absent',()=>{
 expect(resolve({STRIPE_API_KEY:' rk_live_fixture ',STRIPE_WEBHOOK_API:' whsec_live ',STRIPE_LIVE_SECRET_KEY:'  ',STRIPE_LIVE_WEBHOOK_SECRET:' '})).toEqual({liveKey:'rk_live_fixture',testKey:'',liveWebhookSecret:'whsec_live',testWebhookSecret:''});
});
it('does not infer an environment from a webhook secret alone or an invalid key',()=>{
 expect(resolve({STRIPE_API_KEY:'invalid',STRIPE_WEBHOOK_API:'whsec_fixture'})).toEqual({liveKey:'',testKey:'',liveWebhookSecret:'',testWebhookSecret:''});
});
