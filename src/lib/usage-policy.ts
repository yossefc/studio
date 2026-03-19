import { Timestamp } from 'firebase-admin/firestore';

import { ADMIN_EMAIL } from '@/app/actions/admin-auth';
import { getAdminDb } from '@/server/firebase-admin';
import {
  getUsagePlanPreset,
  inferManagedPlanIdFromLimits,
  isManagedUsagePlanId,
  isUsagePlanId,
  type ManagedUsagePlanId,
  type UsagePlanId,
} from '@/lib/usage-plans';

export interface UserUsagePolicy {
  planId: UsagePlanId;
  unlimited: boolean;
  monthlyGenerationLimit: number;
  generationRateLimitUserMax: number;
  exportRateLimitUserMax: number;
  updatedAt?: Timestamp | null;
  updatedByEmail?: string | null;
}

export interface UserUsagePolicyInput {
  planId?: UsagePlanId;
  unlimited?: boolean;
  monthlyGenerationLimit?: number;
  generationRateLimitUserMax?: number;
  exportRateLimitUserMax?: number;
}

export function getDefaultUsagePolicy(): UserUsagePolicy {
  const standardPlan = getUsagePlanPreset('standard');

  return {
    planId: standardPlan.id,
    unlimited: false,
    monthlyGenerationLimit: standardPlan.monthlyGenerationLimit,
    generationRateLimitUserMax: standardPlan.generationRateLimitUserMax,
    exportRateLimitUserMax: standardPlan.exportRateLimitUserMax,
    updatedAt: null,
    updatedByEmail: null,
  };
}

export function getDirectorUsagePolicy(): UserUsagePolicy {
  return {
    planId: 'director',
    unlimited: true,
    monthlyGenerationLimit: Number.MAX_SAFE_INTEGER,
    generationRateLimitUserMax: Number.MAX_SAFE_INTEGER,
    exportRateLimitUserMax: Number.MAX_SAFE_INTEGER,
    updatedAt: null,
    updatedByEmail: ADMIN_EMAIL,
  };
}

function sanitizeNonNegativeInteger(value: unknown, fallback: number): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }

  return Math.max(0, Math.floor(normalized));
}

function sanitizePositiveInteger(value: unknown, fallback: number): number {
  const normalized = sanitizeNonNegativeInteger(value, fallback);
  return normalized === 0 ? fallback : normalized;
}

function getPolicyRef(userId: string) {
  return getAdminDb().collection('users').doc(userId).collection('settings').doc('usagePolicy');
}

function isDirectorEmail(email?: string | null): boolean {
  return (email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

function getPlanValues(planId: ManagedUsagePlanId | 'custom' | 'director'): Pick<
  UserUsagePolicy,
  'monthlyGenerationLimit' | 'generationRateLimitUserMax' | 'exportRateLimitUserMax'
> {
  if (planId === 'director') {
    const director = getDirectorUsagePolicy();
    return {
      monthlyGenerationLimit: director.monthlyGenerationLimit,
      generationRateLimitUserMax: director.generationRateLimitUserMax,
      exportRateLimitUserMax: director.exportRateLimitUserMax,
    };
  }

  if (planId === 'custom') {
    const defaults = getDefaultUsagePolicy();
    return {
      monthlyGenerationLimit: defaults.monthlyGenerationLimit,
      generationRateLimitUserMax: defaults.generationRateLimitUserMax,
      exportRateLimitUserMax: defaults.exportRateLimitUserMax,
    };
  }

  const preset = getUsagePlanPreset(planId);
  return {
    monthlyGenerationLimit: preset.monthlyGenerationLimit,
    generationRateLimitUserMax: preset.generationRateLimitUserMax,
    exportRateLimitUserMax: preset.exportRateLimitUserMax,
  };
}

export function resolveUsagePolicy(
  rawPolicy: Partial<UserUsagePolicyInput & Pick<UserUsagePolicy, 'updatedAt' | 'updatedByEmail'>> | undefined,
  email?: string | null,
): UserUsagePolicy {
  if (isDirectorEmail(email)) {
    return getDirectorUsagePolicy();
  }

  const defaults = getDefaultUsagePolicy();
  const requestedPlanId = isUsagePlanId(rawPolicy?.planId) ? rawPolicy.planId : undefined;
  const basePlanValues = getPlanValues(requestedPlanId && requestedPlanId !== 'director' ? requestedPlanId : defaults.planId);
  const monthlyGenerationLimit = sanitizeNonNegativeInteger(
    rawPolicy?.monthlyGenerationLimit,
    basePlanValues.monthlyGenerationLimit,
  );
  const generationRateLimitUserMax = sanitizePositiveInteger(
    rawPolicy?.generationRateLimitUserMax,
    basePlanValues.generationRateLimitUserMax,
  );
  const exportRateLimitUserMax = sanitizePositiveInteger(
    rawPolicy?.exportRateLimitUserMax,
    basePlanValues.exportRateLimitUserMax,
  );
  const inferredPlanId = requestedPlanId && requestedPlanId !== 'director'
    ? requestedPlanId
    : inferManagedPlanIdFromLimits({
      monthlyGenerationLimit,
      generationRateLimitUserMax,
      exportRateLimitUserMax,
    });

  return {
    planId: inferredPlanId,
    unlimited: Boolean(rawPolicy?.unlimited ?? defaults.unlimited),
    monthlyGenerationLimit,
    generationRateLimitUserMax,
    exportRateLimitUserMax,
    updatedAt: rawPolicy?.updatedAt ?? null,
    updatedByEmail: rawPolicy?.updatedByEmail ?? null,
  };
}

export async function getUserUsagePolicy(user: {
  uid: string;
  email?: string | null;
}): Promise<UserUsagePolicy> {
  if (isDirectorEmail(user.email)) {
    return getDirectorUsagePolicy();
  }

  const snapshot = await getPolicyRef(user.uid).get();
  const rawPolicy = snapshot.exists ? snapshot.data() : undefined;
  return resolveUsagePolicy(rawPolicy, user.email);
}

export async function saveUserUsagePolicy(
  userId: string,
  email: string | null | undefined,
  input: UserUsagePolicyInput,
  updatedByEmail: string,
): Promise<UserUsagePolicy> {
  if (isDirectorEmail(email)) {
    return getDirectorUsagePolicy();
  }

  const requestedPlanId = isUsagePlanId(input.planId) ? input.planId : undefined;
  const presetValues = requestedPlanId && isManagedUsagePlanId(requestedPlanId)
    ? getUsagePlanPreset(requestedPlanId)
    : undefined;
  const nextPolicy = resolveUsagePolicy({
    ...presetValues,
    ...input,
    planId: requestedPlanId ?? input.planId,
  }, email);

  await getPolicyRef(userId).set({
    planId: nextPolicy.planId,
    unlimited: nextPolicy.unlimited,
    monthlyGenerationLimit: nextPolicy.monthlyGenerationLimit,
    generationRateLimitUserMax: nextPolicy.generationRateLimitUserMax,
    exportRateLimitUserMax: nextPolicy.exportRateLimitUserMax,
    updatedAt: Timestamp.now(),
    updatedByEmail,
  }, { merge: true });

  return {
    ...nextPolicy,
    updatedAt: Timestamp.now(),
    updatedByEmail,
  };
}
