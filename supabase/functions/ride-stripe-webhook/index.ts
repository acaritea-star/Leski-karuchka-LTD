import Stripe from 'npm:stripe@22.6.0';
import { createRideStripeWebhook } from '../_shared/rideStripe.ts';
import { rideStripe,rideStripeDependencies } from '../_shared/rideStripeRuntime.ts';
Deno.serve(createRideStripeWebhook({...rideStripeDependencies,
 verify:(body,signature)=>rideStripe.webhooks.constructEventAsync(body,signature,Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET')??'',undefined,Stripe.createSubtleCryptoProvider()),
}));
