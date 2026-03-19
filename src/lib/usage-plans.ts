import {
  EXPORT_RATE_LIMIT_USER_MAX,
  GENERATION_RATE_LIMIT_USER_MAX,
  MAX_MONTHLY_GENERATIONS,
} from '@/lib/constants';

export type ManagedUsagePlanId = 'free' | 'standard' | 'premium';
export type UsagePlanId = ManagedUsagePlanId | 'custom' | 'director';

export interface UsagePlanPreset {
  id: ManagedUsagePlanId;
  label: string;
  monthlyGenerationLimit: number;
  generationRateLimitUserMax: number;
  exportRateLimitUserMax: number;
}

export const USAGE_PLAN_PRESETS: UsagePlanPreset[] = [
  {
    id: 'free',
    label: 'Gratuit',
    monthlyGenerationLimit: 5,
    generationRateLimitUserMax: 1,
    exportRateLimitUserMax: 2,
  },
  {
    id: 'standard',
    label: 'Standard',
    monthlyGenerationLimit: MAX_MONTHLY_GENERATIONS,
    generationRateLimitUserMax: GENERATION_RATE_LIMIT_USER_MAX,
    exportRateLimitUserMax: EXPORT_RATE_LIMIT_USER_MAX,
  },
  {
    id: 'premium',
    label: 'Premium',
    monthlyGenerationLimit: 150,
    generationRateLimitUserMax: 5,
    exportRateLimitUserMax: 15,
  },
];

export function isManagedUsagePlanId(value: unknown): value is ManagedUsagePlanId {
  return typeof value === 'string' && USAGE_PLAN_PRESETS.some((plan) => plan.id === value);
}

export function isUsagePlanId(value: unknown): value is UsagePlanId {
  return value === 'custom' || value === 'director' || isManagedUsagePlanId(value);
}

export function getUsagePlanPreset(planId: ManagedUsagePlanId): UsagePlanPreset {
  const preset = USAGE_PLAN_PRESETS.find((plan) => plan.id === planId);
  if (!preset) {
    throw new Error(`Unknown usage plan: ${planId}`);
  }

  return preset;
}

export function inferManagedPlanIdFromLimits(input: {
  monthlyGenerationLimit: number;
  generationRateLimitUserMax: number;
  exportRateLimitUserMax: number;
}): ManagedUsagePlanId | 'custom' {
  const matchingPlan = USAGE_PLAN_PRESETS.find((plan) =>
    plan.monthlyGenerationLimit === input.monthlyGenerationLimit
    && plan.generationRateLimitUserMax === input.generationRateLimitUserMax
    && plan.exportRateLimitUserMax === input.exportRateLimitUserMax,
  );

  return matchingPlan?.id ?? 'custom';
}
