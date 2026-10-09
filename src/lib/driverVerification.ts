import { queryOptions } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
export type DocumentKind = 'license' | 'insurance';
export type DocumentState = 'missing' | 'missing_expiry' | 'expired' | 'rejected' | 'pending' | 'missing_file' | 'approved';
export type VerificationIssue = { code: string; message: string };
export type VerificationReport = {
  driver_id: string; is_verified: boolean; can_verify: boolean;
  blockers: VerificationIssue[]; warnings: VerificationIssue[];
  documents: Record<DocumentKind, { state: DocumentState; expires_at: string | null }>;
  preparation?: {
    complete: boolean; terms_version: string; training_version: string;
    accepted_at: string | null; training_completed_at: string | null;
  };
};
export const verificationKey = (driverId: string) => ['driver-verification', driverId] as const;
const states = new Set<DocumentState>(['missing', 'missing_expiry', 'expired', 'rejected', 'pending', 'missing_file', 'approved']);
export function parseVerificationReport(value: unknown, driverId: string): VerificationReport {
  const report = value as VerificationReport | null;
  const issues = (list: unknown) => Array.isArray(list) && list.every(item => item && typeof item.code === 'string' && typeof item.message === 'string');
  if (!report || report.driver_id !== driverId || typeof report.is_verified !== 'boolean' || typeof report.can_verify !== 'boolean'
    || !issues(report.blockers) || !issues(report.warnings)
    || !(['license', 'insurance'] as const).every(type => report.documents?.[type] && states.has(report.documents[type].state)
      && (report.documents[type].expires_at === null || /^\d{4}-\d{2}-\d{2}$/.test(report.documents[type].expires_at)))) {
    throw new Error('Не успяхме да потвърдим условията за верификация. Обнови проверката.');
  }
  const preparation = report.preparation;
  if (preparation !== undefined && (!preparation || typeof preparation.complete !== 'boolean'
    || typeof preparation.terms_version !== 'string' || !preparation.terms_version
    || typeof preparation.training_version !== 'string' || !preparation.training_version
    || ![preparation.accepted_at, preparation.training_completed_at].every(value => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value))))
    || (preparation.complete && (!preparation.accepted_at || !preparation.training_completed_at)))) {
    throw new Error('Не успяхме да потвърдим подготовката за верификация. Обнови проверката.');
  }
  return report;
}
export function driverVerificationOptions(driverId: string) {
  return queryOptions({
    queryKey: verificationKey(driverId),
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase.rpc('driver_verification_status', { p_driver: driverId }).abortSignal(abort), 10_000, signal);
      if (error) throw error;
      return parseVerificationReport(data, driverId);
    },
    staleTime: 15_000,
  });
}
