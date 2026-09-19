// Standalone Vite development entry. Not imported by the app or included in its build.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import '@/i18n';
import CustomerLayout from '@/pages/customer/components/CustomerLayout';
import BookingSteps from '@/pages/customer/components/BookingSteps';
import BookingCard from '@/pages/customer/components/BookingCard';
import LocationPicker from '@/pages/customer/components/LocationPicker';
import RequestStatusCard from '@/pages/customer/components/RequestStatusCard';
import { stepAfterSelection, type BookingStep } from '@/pages/customer/components/bookingFlow';
import { calculateFare } from '@/lib/pricing';
import type { LocationPreset } from '@/lib/geo';
import { LOGO_URL } from '@/lib/logo';

const places: LocationPreset[] = [
  { id: 'a', name: 'ул. Софроний Врачански 15', address: 'ул. Софроний Врачански 15, Левски', lat: 43.36, lng: 25.14 },
  { id: 'b', name: 'ЖП гара Левски', address: 'ЖП гара, Левски', lat: 43.35, lng: 25.13 },
  { id: 'c', name: 'ул. Иван Вазов 2', address: 'ул. Иван Вазов 2, Левски', lat: 43.352, lng: 25.13 },
];
const fare = calculateFare({ distanceKm: 1.7, durationMin: 5 });
function Preview() {
  const [step, setStep] = useState<BookingStep>('pickup');
  const [pickup, setPickup] = useState<LocationPreset | null>(null);
  const [destination, setDestination] = useState<LocationPreset | null>(null);
  const [query, setQuery] = useState('');
  const [vehicle, setVehicle] = useState('eco');
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState(false);
  const [cancel, setCancel] = useState(false);
  const select = (place: LocationPreset) => {
    if (step === 'pickup') { setPickup(place); setStep(stepAfterSelection(step, !!destination)); }
    else if (step === 'dest') { setDestination(place); setStep(stepAfterSelection(step, !!pickup)); }
    setQuery('');
  };
  return <CustomerLayout
    map={<div className="absolute inset-0 flex items-center justify-center bg-[#e6ecdf] text-[#65795e] text-sm">Локално превю · карта без връзка с Google</div>}
    header={<><div className="customer-brand"><img src={LOGO_URL} alt="" /><span>Лески каручка<small>Твоят град. Твоят път.</small></span></div><span className="booking-icon-button"><i className="ri-menu-line" /></span></>}
  >
    {active && pickup && destination ? <RequestStatusCard request={{ id: 'preview', status: 'pending', pickup_address: pickup.address, destination_address: destination.address, estimated_price: fare.total }} price={fare.total}
      confirmCancel={cancel} onShowCancel={() => setCancel(true)} onKeepRequest={() => setCancel(false)} onCancel={() => { setActive(false); setCancel(false); }} onReset={() => setActive(false)} onShare={() => {}} requestError="" />
      : <><BookingSteps step={step} canConfirm={!!pickup && !!destination} disabled={creating} onChange={value => { setStep(value); setQuery(''); }} />
        {step === 'confirm' && pickup && destination ? <BookingCard pickup={pickup} destination={destination} onFieldClick={setStep}
          onSwap={() => { setPickup(destination); setDestination(pickup); }} vehicleType={vehicle} onVehicleTypeChange={setVehicle}
          vehicleOptions={[{ id: 'eco', name: 'Economy', capacity: 4, available: true }, { id: 'comfort', name: 'Comfort', capacity: 4, available: true }, { id: 'van', name: 'Van', capacity: 7, available: false }]}
          fare={fare} distance={1.7} duration={5} calculating={false} priceExpired={false} onRefreshPrice={() => {}} canRequest={!creating}
          creating={creating} onRequest={() => { setCreating(true); setTimeout(() => { setCreating(false); setActive(true); }, 700); }} requestError="" />
          : <LocationPicker key={step} searchQuery={query} onSearchChange={setQuery} locating={false} locationError="" recent={places}
            onUseCurrent={() => select(places[0])} onSelect={select} showCurrentLocation={step === 'pickup'} />}
      </>}
  </CustomerLayout>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
