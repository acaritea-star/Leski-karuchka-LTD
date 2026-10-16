import StaffMfaBoundary from '@/components/feature/StaffMfaBoundary';
import ErrorBoundary from '@/components/feature/ErrorBoundary';
import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { AppRoutes } from "./router";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import { AuthProvider } from "@/contexts/AuthContext";
import { AdminCompanyProvider } from "@/pages/admin/components/AdminCompanyContext";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

import DriverGpsProvider from '@/components/feature/DriverGpsProvider';
import DriverOffersProvider from '@/components/feature/DriverOffersProvider';
import CookieConsent from '@/components/feature/CookieConsent';
import OperationTelemetry from '@/components/feature/OperationTelemetry';
import { useAuth } from '@/hooks/useAuth';

const NotificationsProvider = lazy(() => import('@/components/feature/NotificationsProvider'));
function NotificationScope({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user || !/^\/(customer|driver|admin|notifications)\//.test(pathname)) return children;
  return <Suspense fallback={<RouteFallback />}><NotificationsProvider>{children}</NotificationsProvider></Suspense>;
}

function RouteFallback() {
  return (
    <div className="min-h-screen bg-background-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-foreground-200 border-t-primary-500 rounded-full animate-spin" />
    </div>
  );
}

function AppAccess() {
  const { pathname } = useLocation();
  // Complete PKCE before requiring the second factor. No staff providers run here.
  if (pathname === '/auth/callback') return <Suspense fallback={<RouteFallback />}><AppRoutes /></Suspense>;
  return <StaffMfaBoundary><OperationTelemetry /><NotificationScope><DriverGpsProvider><DriverOffersProvider><AdminCompanyProvider>
    <Suspense fallback={<RouteFallback />}><AppRoutes /></Suspense>
  </AdminCompanyProvider></DriverOffersProvider></DriverGpsProvider></NotificationScope></StaffMfaBoundary>;
}

function App() {
  return (
    <ErrorBoundary><I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter basename={__BASE_PATH__}>
            <AppAccess />
            <CookieConsent />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider></ErrorBoundary>
  );
}

export default App;
