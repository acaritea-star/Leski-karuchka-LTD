import { createContext,useContext } from 'react';
import type { CheckoutActions,CheckoutSdk,CheckoutSnapshot } from './stripeCheckoutLoader';
export type CheckoutState={type:'loading'}|{type:'error'}|{type:'success';checkout:CheckoutSnapshot&Pick<CheckoutActions,'confirm'>};
export const CheckoutContext=createContext<{sdk:CheckoutSdk|null;state:CheckoutState}|null>(null);
export function useCheckoutElements():CheckoutState {
 const context=useContext(CheckoutContext);
 if(!context)throw Error('Payment provider unavailable.');
 return context.state;
}
