import { createContext, useContext } from 'react';
export const DriverOfferConnectionContext = createContext(false);
export const useDriverOfferConnection = () => useContext(DriverOfferConnectionContext);
