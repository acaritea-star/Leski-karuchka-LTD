// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { RidePaymentForm } from './RidePaymentElements';
import { paymentPreferenceKey,parseRideElementsSession,type RideElementsSession } from '@/lib/ridePayment';
const fake=vi.hoisted(()=>({confirm:vi.fn(),action:vi.fn(),wallet:false}));
vi.mock('@/lib/supabase',()=>({supabase:{}}));
vi.mock('@/lib/edgeRequest',()=>({invokeEdge:async()=>({data:await fake.action(),error:null}),EdgeRequestError:class extends Error{}}));
vi.mock('@stripe/react-stripe-js/checkout',()=>({
 CheckoutElementsProvider:()=>null,ContactDetailsElement:()=>null,
 useCheckoutElements:()=>({type:'success',checkout:{id:'cs_test_inline',livemode:false,currency:'eur',total:{total:{minorUnitsAmount:295}},email:'stripe-test@example.invalid',canConfirm:true,confirm:fake.confirm}}),
 ExpressCheckoutElement:({onReady,onConfirm}:{onReady:(event:unknown)=>void;onConfirm:(event:unknown)=>void})=>{
  useEffect(()=>{onReady({availablePaymentMethods:{applePay:fake.wallet}});},[onReady]);
  return fake.wallet?<button onClick={()=>onConfirm({paymentType:'apple_pay'})}>Mock Apple Pay</button>:null;
 },PaymentElement:()=> <div aria-label="Защитена форма на Stripe">Карта · Запази само по твой избор</div>,
}));
const session:RideElementsSession={state:'open',environment:'test',ui_mode:'elements',request_id:'ride',session_id:'cs_test_inline',account_id:'acct_fixture',amount_minor:295,currency:'eur',publishable_key:'pk_test_fixture',client_secret:'cs_test_inline_secret_fixture'};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();fake.wallet=false;fake.confirm.mockResolvedValue({type:'success',session:{}});fake.action.mockResolvedValue({state:'open'});});
afterEach(cleanup);
const setup=()=>{const changed=vi.fn(async()=>undefined),busy=vi.fn();render(<RidePaymentForm session={session} userId="owner" onBusy={busy} onChanged={changed}/>);return {changed,busy};};
it('offers the card form when wallets are unavailable and needs one payment confirmation',async()=>{
 const {changed}=setup();await screen.findByRole('button',{name:'Тествай 2.95 €'});fireEvent.click(screen.getByRole('button',{name:'Тествай 2.95 €'}));
 await waitFor(()=>expect(fake.confirm).toHaveBeenCalledOnce());await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
 expect(fake.confirm).toHaveBeenCalledWith(expect.objectContaining({redirect:'if_required'}));expect(fake.confirm.mock.calls[0][0]).not.toHaveProperty('returnUrl');expect(screen.queryByText('Платено онлайн')).toBeNull();
 expect(localStorage.getItem(paymentPreferenceKey('owner','acct_fixture','test'))).toBe('card');
});
it('shows a wallet first and reveals a card without leaving the ride',async()=>{
 fake.wallet=true;setup();await screen.findByRole('button',{name:'Плати с карта'});expect(screen.queryByRole('button',{name:'Тествай 2.95 €'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Плати с карта'}));expect(screen.getByRole('button',{name:'Тествай 2.95 €'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Mock Apple Pay'}));await waitFor(()=>expect(fake.confirm).toHaveBeenCalledWith(expect.objectContaining({expressCheckoutConfirmEvent:{paymentType:'apple_pay'}})));
});
it('keeps a declined card retryable without reporting it paid',async()=>{
 fake.confirm.mockResolvedValue({type:'error',error:{message:'Картата е отказана.'}});const {changed}=setup();
 fireEvent.click(await screen.findByRole('button',{name:'Тествай 2.95 €'}));await screen.findByText('Картата е отказана.');expect(changed).not.toHaveBeenCalled();expect(fake.action).not.toHaveBeenCalled();
 expect((screen.getByRole('button',{name:'Тествай 2.95 €'}) as HTMLButtonElement).disabled).toBe(false);
});
it('blocks a second confirm after a lost response, then reconciles the same payment',async()=>{
 let reject:(error:Error)=>void=()=>{};fake.confirm.mockImplementation(()=>new Promise((_resolve,no)=>{reject=no;}));const {changed}=setup();
 const pay=await screen.findByRole('button',{name:'Тествай 2.95 €'});fireEvent.click(pay);fireEvent.click(pay);expect(fake.confirm).toHaveBeenCalledOnce();
 reject(Error('offline'));await screen.findByText('Връзката прекъсна. Провери плащането преди следващ опит.');
 fake.action.mockResolvedValue({state:'paid'});fireEvent.click(screen.getByRole('button',{name:'Провери плащането'}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(fake.confirm).toHaveBeenCalledOnce();
});
it('scopes the remembered method by user, merchant and environment',()=>{
 localStorage.setItem(paymentPreferenceKey('other','acct_fixture','test'),'card');fake.wallet=true;setup();
 expect(screen.queryByRole('button',{name:'Тествай 2.95 €'})).toBeNull();
 expect(paymentPreferenceKey('owner','acct_fixture','test')).not.toBe(paymentPreferenceKey('owner','acct_fixture','live'));
});
it.each([{environment:'live'},{request_id:'foreign'},{session_id:'cs_test_foreign'},{publishable_key:'pk_live_wrong'},{amount_minor:295.1},{currency:'usd'}])('rejects a payment configuration mismatch %j',mutation=>{
 expect(()=>parseRideElementsSession({...session,...mutation},'ride')).toThrow();
});
