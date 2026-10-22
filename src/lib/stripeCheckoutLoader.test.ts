// @vitest-environment jsdom
import { afterEach,beforeEach,expect,it,vi } from 'vitest';

beforeEach(()=>{vi.resetModules();});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();document.querySelectorAll('script[src^="https://js.stripe.com"]').forEach(node=>node.remove());delete (window as Window&{Stripe?:unknown}).Stripe;});
const script=()=>document.querySelector<HTMLScriptElement>('script[data-ride-stripe-sdk="endive"]')!;
const install=()=>{const factory=Object.assign(vi.fn(()=>({initCheckoutElementsSdk:vi.fn()})),{version:'endive'});Object.assign(window,{Stripe:factory});return factory;};

it('shares one official script download while keeping merchant instances separate',async()=>{
 const {loadStripe,STRIPE_CHECKOUT_SCRIPT}=await import('./stripeCheckoutLoader');
 const first=loadStripe('pk_test_first'),second=loadStripe('pk_test_second');
 expect(document.querySelectorAll('script')).toHaveLength(1);expect(script().src).toBe(STRIPE_CHECKOUT_SCRIPT);
 expect(document.head.innerHTML).not.toContain('pk_test_');
 const factory=install();script().dispatchEvent(new Event('load'));await Promise.all([first,second]);
 expect(factory).toHaveBeenCalledTimes(2);expect(factory).toHaveBeenCalledWith('pk_test_first',{locale:'bg'});expect(factory).toHaveBeenCalledWith('pk_test_second',{locale:'bg'});
});
it('replaces an old global SDK instead of silently using its legacy API',async()=>{
 const old=Object.assign(vi.fn(),{version:'basil'});Object.assign(window,{Stripe:old});
 const {loadStripe}=await import('./stripeCheckoutLoader');const pending=loadStripe('pk_test_owner');
 expect(script().src).toBe('https://js.stripe.com/endive/stripe.js');expect(old).not.toHaveBeenCalled();
 const current=install();script().dispatchEvent(new Event('load'));await pending;expect(current).toHaveBeenCalledOnce();expect(old).not.toHaveBeenCalled();
});
it('recovers from a failed download without retaining a rejected shared promise',async()=>{
 const {loadStripe}=await import('./stripeCheckoutLoader');const first=loadStripe('pk_test_owner');const rejected=expect(first).rejects.toThrow('could not be loaded');
 script().dispatchEvent(new Event('error'));await rejected;expect(script()).toBeNull();
 const retry=loadStripe('pk_test_owner');install();script().dispatchEvent(new Event('load'));await expect(retry).resolves.toHaveProperty('initCheckoutElementsSdk');
});
it('releases a stalled script so a retry can start a fresh download',async()=>{
 vi.useFakeTimers();const {preloadStripeCheckout}=await import('./stripeCheckoutLoader');
 const pending=preloadStripeCheckout();const rejected=expect(pending).rejects.toThrow('could not be loaded');
 await vi.advanceTimersByTimeAsync(10000);await rejected;expect(script()).toBeNull();
 const retry=preloadStripeCheckout();install();script().dispatchEvent(new Event('load'));await expect(retry).resolves.toHaveProperty('version','endive');
});
it('rejects an incompatible script response and a missing modern SDK capability',async()=>{
 const {loadStripe}=await import('./stripeCheckoutLoader');const pending=loadStripe('pk_test_owner');const rejected=expect(pending).rejects.toThrow('could not be loaded');
 Object.assign(window,{Stripe:Object.assign(vi.fn(),{version:'basil'})});script().dispatchEvent(new Event('load'));await rejected;
 Object.assign(window,{Stripe:Object.assign(vi.fn(()=>({initCheckout:vi.fn()})),{version:'endive'})});
 await expect(loadStripe('pk_test_owner')).rejects.toThrow('Unsupported payment SDK');
});
