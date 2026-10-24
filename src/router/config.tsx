import { routeModules } from './routeModules';
import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import NotFound from '@/pages/NotFound';

// Landing shell + home stay eager — they are the first paint of the public site.
import LandingLayout from '@/pages/landing/components/LandingLayout';
import LandingHome from '@/pages/landing/home/page';

// Everything else loads on demand (code splitting → tiny initial bundle for the
// marketing pages; the heavy customer/driver/admin code never loads for visitors).
const AboutPage = lazy(routeModules.AboutPage);
const PricingPage = lazy(routeModules.PricingPage);
const CompanyPartnerPage = lazy(routeModules.CompanyPartnerPage);
const DriverJoinPage = lazy(routeModules.DriverJoinPage);
const ContactPage = lazy(routeModules.ContactPage);
const TermsPage = lazy(routeModules.TermsPage);
const PrivacyPage = lazy(routeModules.PrivacyPage);
const CookiesPage = lazy(routeModules.CookiesPage);
const NewsListPage = lazy(routeModules.NewsListPage);
const NewsArticlePage = lazy(routeModules.NewsArticlePage);

// Auth pages
const Login = lazy(routeModules.Login);
const Register = lazy(routeModules.Register);
const AuthCallback = lazy(routeModules.AuthCallback);
const CompanyLogin = lazy(routeModules.CompanyLogin);
const CompanyEntry = lazy(routeModules.CompanyEntry);
const CompanySetup = lazy(routeModules.CompanySetup);
const DriverLogin = lazy(routeModules.DriverLogin);
const DriverAccess = lazy(routeModules.DriverAccess);

// Customer pages
const CustomerHome = lazy(routeModules.CustomerHome);
const CustomerOrders = lazy(routeModules.CustomerOrders);
const CustomerProfile = lazy(routeModules.CustomerProfile);
const CustomerSettings = lazy(routeModules.CustomerSettings);
const NotificationOpen = lazy(routeModules.NotificationOpen);

// Driver pages
const DriverHome = lazy(routeModules.DriverHome);
const DriverRequests = lazy(routeModules.DriverRequests);
const DriverHistory = lazy(routeModules.DriverHistory);
const DriverEarnings = lazy(routeModules.DriverEarnings);
const DriverProfile = lazy(routeModules.DriverProfile);
const DriverPreparation = lazy(routeModules.DriverPreparation);

// Admin pages
const AdminCompanies = lazy(routeModules.AdminCompanies);
const AdminDivisions = lazy(routeModules.AdminDivisions);
const AdminDashboard = lazy(routeModules.AdminDashboard);
const AdminMap = lazy(routeModules.AdminMap);
const AdminDrivers = lazy(routeModules.AdminDrivers);
const AdminVehicles = lazy(routeModules.AdminVehicles);
const AdminCustomers = lazy(routeModules.AdminCustomers);
const AdminOrders = lazy(routeModules.AdminOrders);
const AdminPricing = lazy(routeModules.AdminPricing);
const AdminAnalytics = lazy(routeModules.AdminAnalytics);
const AdminSettings = lazy(routeModules.AdminSettings);
const AdminNews = lazy(routeModules.AdminNews);
const AdminNewsEdit = lazy(routeModules.AdminNewsEdit);

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
      { path: 'company-partner', element: <CompanyPartnerPage /> },
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
  { path: '/company/login', element: <CompanyLogin /> },
  { path: '/driver/login', element: <DriverLogin /> },
  { path: '/driver/access', element: <DriverAccess /> },
  { path: '/company/setup', element: <AuthGuard redirectTo="/company/login" companyScoped={false} allowedRoles={['COMPANY_ADMIN', 'SUPER_ADMIN']}><CompanySetup /></AuthGuard> },
  { path: '/company', element: <CompanyEntry /> },
  { path: '/admin', element: <AuthGuard allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']} redirectTo="/company/login" companyScoped={false}><AppRedirect /></AuthGuard> },

  // ─── Legal pages (public) ────────────────────────────────────────────────
  { path: '/terms', element: <TermsPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/cookies', element: <CookiesPage /> },

  // ─── App redirect (for logged-in users) ──────────────────────────────────
  { path: '/app', element: <AppRedirect /> },
  { path: '/notifications/open', element: <NotificationOpen /> },

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
  { path: '/driver/preparation', element: <AuthGuard allowedRoles={['DRIVER']} showLegalNotice={false}><DriverPreparation /></AuthGuard> },

  // ─── Admin ────────────────────────────────────────────────────────────────
  { path: '/admin/companies', element: <AuthGuard redirectTo="/company/login" companyScoped={false} allowedRoles={['SUPER_ADMIN']}><AdminCompanies /></AuthGuard> },
  { path: '/admin/divisions', element: <AuthGuard redirectTo="/company/login" companyScoped={false} allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminDivisions /></AuthGuard> },
  { path: '/admin/dashboard', element: <AuthGuard redirectTo="/company/login" allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminDashboard /></AuthGuard> },
  { path: '/admin/map', element: <AuthGuard redirectTo="/company/login" allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminMap /></AuthGuard> },
  { path: '/admin/drivers', element: <AuthGuard redirectTo="/company/login" allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminDrivers /></AuthGuard> },
  { path: '/admin/vehicles', element: <AuthGuard redirectTo="/company/login" allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminVehicles /></AuthGuard> },
  { path: '/admin/customers', element: <AuthGuard redirectTo="/company/login" allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminCustomers /></AuthGuard> },
  { path: '/admin/orders', element: <AuthGuard redirectTo="/company/login" allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminOrders /></AuthGuard> },
  { path: '/admin/pricing', element: <AuthGuard redirectTo="/company/login" allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminPricing /></AuthGuard> },
  { path: '/admin/analytics', element: <AuthGuard redirectTo="/company/login" allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminAnalytics /></AuthGuard> },
  { path: '/admin/settings', element: <AuthGuard redirectTo="/company/login" allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}><AdminSettings /></AuthGuard> },
  { path: '/admin/news', element: <AuthGuard redirectTo="/company/login" companyScoped={false} allowedRoles={['SUPER_ADMIN']}><AdminNews /></AuthGuard> },
  { path: '/admin/news/new', element: <AuthGuard redirectTo="/company/login" companyScoped={false} allowedRoles={['SUPER_ADMIN']}><AdminNewsEdit /></AuthGuard> },
  { path: '/admin/news/:id', element: <AuthGuard redirectTo="/company/login" companyScoped={false} allowedRoles={['SUPER_ADMIN']}><AdminNewsEdit /></AuthGuard> },

  { path: '*', element: <NotFound /> },
];

export default routes;
