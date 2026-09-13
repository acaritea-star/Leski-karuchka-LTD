import ErrorBoundary from '@/components/feature/ErrorBoundary';
import { Suspense } from "react";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./router";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import { AuthProvider } from "@/contexts/AuthContext";
import { AdminCompanyProvider } from "@/pages/admin/components/AdminCompanyContext";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

import DriverGpsProvider from '@/components/feature/DriverGpsProvider';

function RouteFallback() {
  return (
    <div className="min-h-screen bg-background-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-foreground-200 border-t-primary-500 rounded-full animate-spin" />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary><I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter basename={__BASE_PATH__}>
            <DriverGpsProvider><AdminCompanyProvider>
              <Suspense fallback={<RouteFallback />}>
                <AppRoutes />
              </Suspense>
            </AdminCompanyProvider></DriverGpsProvider>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider></ErrorBoundary>
  );
}

export default App;