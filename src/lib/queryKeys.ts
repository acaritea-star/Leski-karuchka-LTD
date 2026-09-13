/**
 * Central query-key factory.
 *
 * Query keys are the cache identity in TanStack Query. Keeping them in one
 * place means invalidating the right slice (e.g. after a mutation) is always
 * predictable and never relies on a hand-typed string.
 */
export const queryKeys = {
  customerOrders: (customerId: string) => ['taxi_requests', 'customer', customerId] as const,
  customerRatings: (customerId: string) => ['ratings', 'customer', customerId] as const,

  // ── Driver ──
  driverRecord: (userId: string) => ['drivers', 'me', userId] as const,
  driverActiveRequest: (driverId: string) => ['taxi_requests', 'driver', driverId, 'active'] as const,
  driverTodayStats: (driverId: string) => ['taxi_requests', 'driver', driverId, 'today'] as const,
  driverPendingCount: (companyId: string) => ['taxi_requests', 'company', companyId, 'pending-count'] as const,
  driverPendingList: (companyId: string) => ['taxi_requests', 'company', companyId, 'pending-list'] as const,
  driverIncomingRequests: (companyId: string) => ['taxi_requests', 'company', companyId, 'incoming'] as const,
  driverHistory: (driverId: string, filter: string) => ['taxi_requests', 'driver', driverId, 'history', filter] as const,
  driverEarnings: (driverId: string) => ['taxi_requests', 'driver', driverId, 'earnings'] as const,

  // ── Admin ──
  adminDrivers: (companyId: string) => ['drivers', 'company', companyId] as const,
  adminVehicles: (companyId: string) => ['vehicles', 'company', companyId] as const,
  adminOrders: (companyId: string) => ['taxi_requests', 'company', companyId] as const,
  adminCustomers: (companyId: string) => ['profiles', 'company', companyId, 'customers'] as const,
  adminDashboard: (companyId: string) => ['dashboard', companyId] as const,
  driverDocuments: (driverId: string) => ['driver_documents', driverId] as const,
} as const;