// @vitest-environment jsdom
import { useEffect } from 'react';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import RidePaymentElements,{ RidePaymentForm } from './RidePaymentElements';
import { paymentPreferenceKey,parseRideElementsSession,type RideElementsSession } from '@/lib/ridePayment';
const fake=vi.hoisted(()=>({confirm:vi.fn(),action:vi.fn(),wallet:false,phase:'success',amount:295}));
vi.mock('@/lib/supabase',()=>({supabase:{}}));
vi.mock('@/lib/edgeRequest',()=>({invokeEdge:async()=>({data:await fake.action(),error:null}),EdgeRequestError:class extends Error{}}));
vi.mock('@/lib/stripeCheckoutLoader',()=>({loadStripe:vi.fn(async()=>null)}));
vi.mock('@/lib/stripeCheckout',()=>({
 CheckoutElementsProvider:()=>null,ContactDetailsElement:()=>null,
 ExpressCheckoutElement:({onReady,onConfirm}:{onReady:(event:unknown)=>void;onConfirm:(event:unknown)=>void})=>{
  useEffect(()=>{onReady({availablePaymentMethods:{applePay:fake.wallet}});},[onReady]);
  return fake.wallet?<button onClick={()=>onConfirm({paymentType:'apple_pay'})}>Mock Apple Pay</button>:null;
 },PaymentElement:({onReady}:{onReady:()=>void})=>{useEffect(()=>onReady(),[onReady]);return <input aria-label="Защитена форма на Stripe"/>;},
}));
vi.mock('@/lib/stripeCheckoutState',()=>({useCheckoutElements:()=>fake.phase==='success'?({type:'success',checkout:{id:'cs_test_inline',livemode:false,currency:'eur',total:{total:{minorUnitsAmount:fake.amount}},email:'stripe-test@example.invalid',canConfirm:true,confirm:fake.confirm}}):({type:fake.phase,error:{message:'SDK unavailable'}})}));
const session:RideElementsSession={state:'open',environment:'test',ui_mode:'elements',request_id:'ride',session_id:'cs_test_inline',account_id:'acct_fixture',amount_minor:295,currency:'eur',publishable_key:'pk_test_fixture',client_secret:'cs_test_inline_secret_fixture'};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();fake.wallet=false;fake.phase='success';fake.amount=295;fake.confirm.mockResolvedValue({type:'success',session:{}});fake.action.mockResolvedValue({state:'open'});});
afterEach(()=>{cleanup();vi.useRealTimers();});
const setup=()=>{const changed=vi.fn(async()=>undefined),busy=vi.fn(),retry=vi.fn();render(<RidePaymentForm session={session} userId="owner" onBusy={busy} onChanged={changed} onRetry={retry}/>);return {changed,busy,retry};};
it('does not request a Session while preparing an unfinished ride, or re-request when reopening',async()=>{
 fake.action.mockResolvedValue(session);const props={requestId:'ride',userId:'owner',onClose:()=>{},onChanged:async()=>{},preparation:session};
 const view=render(<RidePaymentElements {...props} open={false} enabled={false}/>);
 await act(async()=>{});expect(fake.action).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
 view.rerender(<RidePaymentElements {...props} open={false} enabled/>);
 await waitFor(()=>expect(fake.action).toHaveBeenCalledOnce());await act(async()=>{});
 view.rerender(<RidePaymentElements {...props} open enabled/>);await screen.findByText('Сума за плащане');
 view.rerender(<RidePaymentElements {...props} open={false} enabled/>);
 view.rerender(<RidePaymentElements {...props} open enabled/>);await act(async()=>{});expect(fake.action).toHaveBeenCalledOnce();expect(fake.confirm).not.toHaveBeenCalled();
});
it.each([null,session])('cannot confirm a hidden or unbound prepared form',async(value)=>{
 fake.wallet=true;render(<RidePaymentForm session={value} preparation={session} active={false} userId="owner" onBusy={()=>{}} onChanged={async()=>{}} onRetry={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Mock Apple Pay'}));expect(fake.confirm).not.toHaveBeenCalled();expect(fake.action).not.toHaveBeenCalled();
});
it('keeps the form mounted during slow actions and offers recovery without confirming or canceling money',()=>{
 vi.useFakeTimers();fake.phase='loading';const {retry,changed}=setup();
 expect(screen.getByText('Подготвяме начините за плащане…')).toBeTruthy();
 const input=screen.getByLabelText('Защитена форма на Stripe');fireEvent.change(input,{target:{value:'synthetic input'}});
 fireEvent.click(screen.getByRole('button',{name:'Тествай 2.95 €'}));expect(fake.confirm).not.toHaveBeenCalled();
 act(()=>{vi.advanceTimersByTime(12000);});
 expect(screen.getByLabelText('Защитена форма на Stripe')).toBe(input);expect((input as HTMLInputElement).value).toBe('synthetic input');
 fireEvent.click(screen.getByRole('button',{name:'Зареди плащането отново'}));
 expect(retry).toHaveBeenCalledOnce();expect(fake.confirm).not.toHaveBeenCalled();expect(fake.action).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
});
it('blocks both payment paths when Stripe returns a different fare',()=>{
 fake.amount=999;fake.wallet=true;setup();expect(screen.getByRole('alert').textContent).toContain('Сумата не съвпада');
 expect(screen.queryByRole('button',{name:'Mock Apple Pay'})).toBeNull();expect(fake.confirm).not.toHaveBeenCalled();
});
it('offers local recovery when Stripe initialization fails',()=>{
 fake.phase='error';const {retry}=setup();fireEvent.click(screen.getByRole('button',{name:'Зареди плащането отново'}));
 expect(retry).toHaveBeenCalledOnce();expect(fake.confirm).not.toHaveBeenCalled();expect(fake.action).not.toHaveBeenCalled();
});
it('does not restart the Session request for a new parent callback identity',async()=>{
 fake.action.mockResolvedValue(session);
 const view=render(<RidePaymentElements requestId="ride" userId="owner" onClose={()=>{}} onChanged={async()=>{}}/>);
 await screen.findByText('Сума за плащане');expect(fake.action).toHaveBeenCalledOnce();
 view.rerender(<RidePaymentElements requestId="ride" userId="owner" onClose={()=>{}} onChanged={async()=>{}}/>);
 await act(async()=>{});expect(fake.action).toHaveBeenCalledOnce();
});
it('offers the card form when wallets are unavailable and needs one payment confirmation',async()=>{
 const {changed}=setup();await screen.findByRole('button',{name:'Тествай 2.95 €'});fireEvent.click(screen.getByRole('button',{name:'Тествай 2.95 €'}));
 await waitFor(()=>expect(fake.confirm).toHaveBeenCalledOnce());await waitFor(()=>expect(changed).toHaveBeenCalledTimes(2));
 expect(fake.confirm).toHaveBeenCalledWith(expect.objectContaining({redirect:'if_required'}));expect(fake.confirm.mock.calls[0][0]).not.toHaveProperty('returnUrl');expect(screen.queryByText('Платено онлайн')).toBeNull();
 expect(localStorage.getItem(paymentPreferenceKey('owner','acct_fixture','test'))).toBe('card');
});
it('keeps card entry visible alongside a wallet without an extra tap',async()=>{
 fake.wallet=true;setup();await screen.findByRole('button',{name:'Mock Apple Pay'});
 expect(screen.getByRole('button',{name:'Тествай 2.95 €'})).toBeTruthy();
 const input=screen.getByLabelText('Защитена форма на Stripe');fireEvent.change(input,{target:{value:'synthetic input'}});
 expect((input as HTMLInputElement).value).toBe('synthetic input');
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
it('does not hide card entry because of another user or an old wallet preference',()=>{
 localStorage.setItem(paymentPreferenceKey('other','acct_fixture','test'),'card');fake.wallet=true;setup();
 expect(screen.getByRole('button',{name:'Тествай 2.95 €'})).toBeTruthy();
 expect(paymentPreferenceKey('owner','acct_fixture','test')).not.toBe(paymentPreferenceKey('owner','acct_fixture','live'));
});
it.each([{environment:'live'},{request_id:'foreign'},{session_id:'cs_test_foreign'},{publishable_key:'pk_live_wrong'},{amount_minor:295.1},{currency:'usd'}])('rejects a payment configuration mismatch %j',mutation=>{
 expect(()=>parseRideElementsSession({...session,...mutation},'ride')).toThrow();
});

it('uses the webhook-confirmed database receipt without a second Stripe reconciliation',async()=>{
 const changed=vi.fn(async()=>true);render(<RidePaymentForm session={session} userId="owner" onBusy={()=>{}} onChanged={changed} onRetry={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Тествай 2.95 €'}));
 await waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(fake.action).not.toHaveBeenCalled();expect(fake.confirm).toHaveBeenCalledOnce();
 expect(screen.queryByText('Платено онлайн')).toBeNull();
});
