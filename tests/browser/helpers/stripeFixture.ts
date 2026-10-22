import type { Page } from '@playwright/test';
/** A local UI double, never used in production or as proof of Stripe settlement. */
export async function installStripeUiDouble(page:Page,wallet=false,challenge=false,options:{initialization?:'stalled-first'|'error-first';scriptedLoader?:boolean}={}) {
 if(options.scriptedLoader)await page.route('https://js.stripe.com/**',route=>route.fulfill({contentType:'application/javascript',body:'window.stripeUiDouble.scriptDownloads++;window.Stripe=window.stripeUiDoubleFactory;'}));
 await page.addInitScript(({wallet,challenge,options})=>{
  const controls={confirms:0,initialisations:0,scriptDownloads:0};Object.assign(window,{stripeUiDouble:controls});
  const session={id:'cs_test_inline',livemode:false,currency:'eur',email:'stripe-test@example.invalid',canConfirm:true,total:{total:{minorUnitsAmount:295}},savedPaymentMethods:[],status:{type:'open'}};
  const element=(kind:string)=>{
   const handlers:Record<string,(event:unknown)=>void>={};let node:HTMLElement|null=null;
   const ready=()=>handlers.ready?.({availablePaymentMethods:wallet?{applePay:true}:null});
   return {on:(name:string,handler:(event:unknown)=>void)=>{handlers[name]=handler;if(name==='ready'&&node)setTimeout(ready,0);},off:(name:string)=>{delete handlers[name];},update:()=>{},
    mount:(target:HTMLElement)=>{node=target;
     if(kind==='express'&&wallet){const button=document.createElement('button');button.textContent='Mock Apple Pay';button.type='button';button.style.cssText='width:100%;height:48px;background:#111;color:white;border-radius:12px';button.onclick=()=>handlers.confirm?.({paymentType:'apple_pay'});target.appendChild(button);}
     if(kind==='payment'){const label=document.createElement('label');label.textContent='Тестова защитена форма на Stripe';const input=document.createElement('input');input.setAttribute('aria-label','Тестова карта');input.placeholder='4242 4242 4242 4242';input.style.cssText='width:100%;padding:14px;border:1px solid #ddd;border-radius:12px';label.appendChild(input);target.appendChild(label);}
     setTimeout(ready,0);
    },destroy:()=>{node?.replaceChildren();node=null;},unmount:()=>{node?.replaceChildren();node=null;}};
  };
  const factory=()=>({elements:()=>{},createToken:()=>{},createPaymentMethod:()=>{},confirmCardPayment:()=>{},_registerWrapper:()=>{},registerAppInfo:()=>{},
   initCheckoutElementsSdk:()=>{const initialization=++controls.initialisations;return {
    on:()=>{},changeAppearance:()=>{},createExpressCheckoutElement:()=>element('express'),createPaymentElement:()=>element('payment'),createContactDetailsElement:()=>element('contact'),
    loadActions:async()=>{
     if(initialization===1&&options.initialization==='stalled-first')await new Promise<void>(()=>{});
     if(initialization===1&&options.initialization==='error-first')throw Error('Test SDK initialization failure');
     return {type:'success',actions:{getSession:()=>session,confirm:async(args?:{returnUrl?:string})=>{
     if(args?.returnUrl)throw Error('Session return_url and confirm returnUrl are mutually exclusive');
     controls.confirms++;
     if(challenge)await new Promise<void>(resolve=>{
      setTimeout(()=>{
      const bank=document.createElement('div');bank.setAttribute('role','dialog');bank.setAttribute('aria-label','Mock bank authentication');
      bank.style.cssText='position:fixed;inset:20px;z-index:2147483000;background:white;display:grid;place-items:center';
      const approve=document.createElement('button');approve.textContent='Потвърди тестовата банкова проверка';approve.onclick=()=>{bank.remove();resolve();};bank.appendChild(approve);document.body.appendChild(bank);approve.focus();
      },0);
     });
     return {type:'success',session};
    }}};},
   };},
  });
  Object.assign(window,options.scriptedLoader?{stripeUiDoubleFactory:factory}:{Stripe:factory});
 },{wallet,challenge,options});
}
