import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import NotFound from '@/pages/NotFound';

// Landing shell + home stay eager — they are the first paint of the public site.
import LandingLayout from '@/pages/landing/components/LandingLayout';
import LandingHome from '@/pages/landing/home/page';

// Everything else loads on demand (code splitting → tiny initial bundle for the
// marketing pages; the heavy customer/driver/admin code never loads for visitors).
const AboutPage = lazy(() => import('@/pages/landing/about/page'));
const PricingPage = lazy(() => import('@/pages/landing/pricing/page'));
const DriverJoinPage = lazy(() => import('@/pages/landing/driver-join/page'));
const ContactPage = lazy(() => import('@/pages/landing/contact/page'));
const TermsPage = lazy(() => import('@/pages/landing/terms/page'));
const PrivacyPage = lazy(() => import('@/pages/landing/privacy/page'));
const CookiesPage = lazy(() => import('@/pages/landing/cookies/page'));
const NewsListPage = lazy(() => import('@/pages/landing/news/page'));
const NewsArticlePage = lazy(() => import('@/pages/landing/news/article/page'));

// Auth pages
const Login = lazy(() => import('@/pages/auth/login/page'));
const Register = lazy(() => import('@/pages/auth/register/page'));
const AuthCallback = lazy(() => import('@/pages/auth/callback/page'));

// Customer pages
const CustomerHome = lazy(() => import('@/pages/customer/home/page'));
const CustomerOrders = lazy(() => import('@/pages/customer/orders/page'));
const CustomerProfile = lazy(() => import('@/pages/customer/profile/page'));
const CustomerSettings = lazy(() => import('@/pages/customer/settings/page'));

// Driver pages
const DriverHome = lazy(() => import('@/pages/driver/home/page'));
const DriverRequests = lazy(() => import('@/pages/driver/requests/page'));
const DriverHistory = lazy(() => import('@/pages/driver/history/page'));
const DriverEarnings = lazy(() => import('@/pages/driver/earnings/page'));
const DriverProfile = lazy(() => import('@/pages/driver/profile/page'));

// Admin pages
const AdminCompanies = lazy(() => import('@/pages/admin/companies/page'));
const AdminDashboard = lazy(() => import('@/pages/admin/dashboard/page'));
const AdminMap = lazy(() => import('@/pages/admin/map/page'));
const AdminDrivers = lazy(() => import('@/pages/admin/drivers/page'));
const AdminVehicles = lazy(() => import('@/pages/admin/vehicles/page'));
const AdminCustomers = lazy(() => import('@/pages/admin/customers/page'));
const AdminOrders = lazy(() => import('@/pages/admin/orders/page'));
const AdminPricing = lazy(() => import('@/pages/admin/pricing/page'));
const AdminAnalytics = lazy(() => import('@/pages/admin/analytics/page'));
const AdminSettings = lazy(() => import('@/pages/admin/settings/page'));
const AdminNews = lazy(() => import('@/pages/admin/news/page'));
const AdminNewsEdit = lazy(() => import('@/pages/admin/news/edit/page'));

import AppRedirect from '@/pages/home/page';
import AuthGuard from '@/components/feature/AuthGuard';

const routes: RouteObject[] = [
  // ─── Public Marketing Site ───────────────────────────────────────────────
  {
    path: '/',
    element: <LandingLayout />,
    children: [
      { index: true, element: <LandingHome /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'pricing', element: <PricingPage /> },
      { path: 'driver-join', element: <DriverJoinPage /> },
      { path: 'contact', element: <ContactPage /> },
      { path: 'novini', element: <NewsListPage /> },
      { path: 'novini/:slug', element: <NewsArticlePage /> },
    ],
  },

  // ─── Auth ─────────────────────────────────────────────────────────────────
  { path: '/auth/login', element: <Login /> },
  { path: '/auth/register', element: <Register /> },
  { path: '/auth/callback', element: <AuthCallback /> },

  // ─── Legal pages (public) ────────────────────────────────────────────────
  { path: '/terms', element: <TermsPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/cookies', element: <CookiesPage /> },

  // ─── App redirect (for logged-in users) ──────────────────────────────────
  { path: '/app', element: <AppRedirect /> },

  // ─── Customer ─────────────────────────────────────────────────────────────
  { path: '/customer/home', element: <AuthGuard allowedRoles={['CUSTOMER']}><CustomerHome /></AuthGuard> },
  { path: '/customer/orders', element: <AuthGuard allowedRoles={['CUSTOMER']}><CustomerOrders /></AuthGuard> },
  { path: '/customer/profile', element: <AuthGuard allowedRoles={['CUSTOMER']}><CustomerProfile /></AuthGuard> },
  { path: '/customer/settings', element: <AuthGuard allowedRoles={['CUSTOMER']}><CustomerSettings /></AuthGuard> },

  // ─── Driver ───────────────────────────────────────────────────────────────
  { path: '/driver/home', element: <AuthGuard allowedRoles={['DRIVER']}><DriverHome /></AuthGuard> },
  { path: '/driver/requests', element: <AuthGuard allowedRoles={['DRIVER']}><DriverRequests /></AuthGuard> },
  { path: '/driver/history', element: <AuthGuard allowedRoles={['DRIVER']}><DriverHistory /></AuthGuard> },
  { path: '/driver/earnings', element: <AuthGuard allowedRoles={['DRIVER']}><DriverEarnings /></AuthGuard> },
  { path: '/driver/profile', element: <AuthGuard allowedRoles={['DRIVER']}><DriverProfile /></AuthGuard> },

  // ─── Admin ────────────────────────────────────────────────────────────────
  { path: '/admin/companies', element: <AuthGuard allowedRoles={['SUPER_ADMIN']}><AdminCompanies /></AuthGuard> },
  { path: '/admin/dashboard', element: <AuthGuard allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminDashboard /></AuthGuard> },
  { path: '/admin/map', element: <AuthGuard allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminMap /></AuthGuard> },
  { path: '/admin/drivers', element: <AuthGuard allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminDrivers /></AuthGuard> },
  { path: '/admin/vehicles', element: <AuthGuard allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminVehicles /></AuthGuard> },
  { path: '/admin/customers', element: <AuthGuard allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminCustomers /></AuthGuard> },
  { path: '/admin/orders', element: <AuthGuard allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminOrders /></AuthGuard> },
  { path: '/admin/pricing', element: <AuthGuard allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminPricing /></AuthGuard> },
  { path: '/admin/analytics', element: <AuthGuard allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminAnalytics /></AuthGuard> },
  { path: '/admin/settings', element: <AuthGuard allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminSettings /></AuthGuard> },
  { path: '/admin/news', element: <AuthGuard allowedRoles={['SUPER_ADMIN']}><AdminNews /></AuthGuard> },
  { path: '/admin/news/new', element: <AuthGuard allowedRoles={['SUPER_ADMIN']}><AdminNewsEdit /></AuthGuard> },
  { path: '/admin/news/:id', element: <AuthGuard allowedRoles={['SUPER_ADMIN']}><AdminNewsEdit /></AuthGuard> },

  { path: '*', element: <NotFound /> },
];

export default routes;