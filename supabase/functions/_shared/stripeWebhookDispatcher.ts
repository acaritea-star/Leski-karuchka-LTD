type Verify=(body:string,signature:string)=>Promise<unknown>;
type Handler=(request:Request)=>Promise<Response>;
/** One URL, independent signing secrets. Only a verified event selects its
 * environment. An unsigned livemode flag can never select the real ledger. */
export function createStripeWebhookDispatcher(deps:{sandboxVerify:Verify;liveVerify:Verify;sandbox:Handler;live:Handler}) {
 const error=(status:number,result:string)=>new Response(JSON.stringify({result}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return error(405,'method_not_allowed');
  const signature=request.headers.get('stripe-signature');if(!signature)return error(400,'invalid_signature');
  const body=await request.text();if(body.length>1000000)return error(413,'payload_too_large');
  for(const candidate of [{verify:deps.sandboxVerify,mode:false,handle:deps.sandbox},{verify:deps.liveVerify,mode:true,handle:deps.live}]) {
   try {
    const event=await candidate.verify(body,signature);
    if(!event||typeof event!=='object'||!('livemode' in event)||event.livemode!==candidate.mode)continue;
    return candidate.handle(new Request(request.url,{method:'POST',headers:request.headers,body}));
   }catch { /* Try the other independently configured signing secret. */ }
  }
  return error(400,'invalid_signature');
 };
}
