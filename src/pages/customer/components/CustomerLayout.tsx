import EmergencyHelp from '@/components/feature/EmergencyHelp';
import type { ReactNode } from 'react';
import { useCustomerViewport } from '@/hooks/useCustomerViewport';
import './customer.css';

export type CarrierPanelView = 'preview' | 'all' | 'selected' | 'details';

export default function CustomerLayout({ map, header, notice, mapControls, children, expanded = false, offers = false, offerView = 'preview' }: {
  map: ReactNode; header: ReactNode; notice?: ReactNode; mapControls?: ReactNode; children: ReactNode; expanded?: boolean; offers?: boolean; offerView?: CarrierPanelView;
}) {
  const viewportRef = useCustomerViewport();
  return <div ref={viewportRef} className="customer-experience" data-expanded={expanded} data-offers={offers} data-offer-view={offerView} data-notice={!!notice}>
    <div className="customer-map">{map}<div className="customer-safety"><EmergencyHelp /></div></div>
    <header className="customer-header">{header}</header>
    {notice && <div className="customer-notice" role="status">{notice}</div>}
    {mapControls && <div className="customer-route-controls">{mapControls}</div>}
    <main className="customer-sheet">{children}</main>
  </div>;
}

export function BookingSkeleton({ label }: { label: string }) {
  return <div className="booking-skeleton" role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span><div className="skeleton-line w-2/3" />
    <div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line w-3/4" />
  </div>;
}
