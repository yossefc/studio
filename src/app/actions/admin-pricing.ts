'use server';

/**
 * Admin actions for managing pricing configuration.
 */

import { getAuthenticatedUser } from '@/lib/server-auth';
import { isAdminUser } from '@/lib/admin-role';
import { getAdminDb } from '@/server/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export interface PricingPlan {
  id: string;
  name: string;
  nameHe: string;
  price: number;
  period: 'month' | 'one-time';
  credits: number;
  features: string[];
  isActive: boolean;
}

export interface PricingConfig {
  plans: PricingPlan[];
  updatedAt?: string;
  updatedBy?: string;
}

const DEFAULT_PRICING: PricingConfig = {
  plans: [
    {
      id: 'standard',
      name: 'Standard',
      nameHe: 'מסלול בסיסי',
      price: 14,
      period: 'month',
      credits: 30,
      features: [
        '30 ביאורים בחודש',
        'גישה מלאה לשולחן ערוך',
        'ייצוא ל-Google Docs',
        'ביאור משנה ברורה ובית יוסף',
        'ביטול בכל עת',
      ],
      isActive: true,
    },
    {
      id: 'premium',
      name: 'Premium',
      nameHe: 'מסלול פרימיום',
      price: 29,
      period: 'month',
      credits: 100,
      features: [
        '100 ביאורים בחודש',
        'מנוע AI מתקדם (Gemini Pro)',
        'ניתוח מעמיק יותר',
        'עדיפות בתור העיבוד',
        'תמיכה מועדפת',
      ],
      isActive: true,
    },
    {
      id: 'topup',
      name: 'Top-up',
      nameHe: 'הוספת קרדיטים',
      price: 5,
      period: 'one-time',
      credits: 10,
      features: [
        '10 ביאורים נוספים',
        'תשלום חד פעמי',
        'ללא התחייבות',
        'שימוש מיידי',
      ],
      isActive: true,
    },
  ],
};

async function verifyAdmin(): Promise<{ uid: string; email: string }> {
  const authUser = await getAuthenticatedUser();
  const isAdmin = await isAdminUser(authUser);
  if (!isAdmin) {
    throw new Error('Unauthorized: Admin access required');
  }
  return { uid: authUser.uid, email: authUser.email || '' };
}

/**
 * Get the current pricing configuration.
 */
export async function getPricingConfig(): Promise<PricingConfig> {
  try {
    const db = getAdminDb();
    const doc = await db.collection('settings').doc('pricing').get();

    if (!doc.exists) {
      return DEFAULT_PRICING;
    }

    const data = doc.data();
    return {
      plans: Array.isArray(data?.plans) ? data.plans : DEFAULT_PRICING.plans,
      updatedAt: data?.updatedAt?.toDate?.()?.toISOString?.() || undefined,
      updatedBy: data?.updatedBy || undefined,
    };
  } catch (error) {
    console.error('[Admin] Failed to get pricing config:', error);
    return DEFAULT_PRICING;
  }
}

/**
 * Update the pricing configuration (admin only).
 */
export async function updatePricingConfig(
  token: string,
  config: Partial<PricingConfig>
): Promise<PricingConfig> {
  const admin = await verifyAdmin();
  const db = getAdminDb();

  // Validate plans
  if (config.plans) {
    for (const plan of config.plans) {
      if (!plan.id || typeof plan.price !== 'number' || plan.price < 0) {
        throw new Error('Invalid plan configuration');
      }
    }
  }

  const currentConfig = await getPricingConfig();
  const newConfig: PricingConfig = {
    ...currentConfig,
    ...config,
    plans: config.plans || currentConfig.plans,
  };

  await db.collection('settings').doc('pricing').set({
    plans: newConfig.plans,
    updatedAt: Timestamp.now(),
    updatedBy: admin.email,
  });

  return {
    ...newConfig,
    updatedAt: new Date().toISOString(),
    updatedBy: admin.email,
  };
}

/**
 * Update a single plan's price (admin only).
 */
export async function updatePlanPrice(
  token: string,
  planId: string,
  newPrice: number
): Promise<PricingConfig> {
  const admin = await verifyAdmin();
  const config = await getPricingConfig();

  const planIndex = config.plans.findIndex(p => p.id === planId);
  if (planIndex === -1) {
    throw new Error(`Plan not found: ${planId}`);
  }

  config.plans[planIndex].price = newPrice;

  return updatePricingConfig(token, config);
}

/**
 * Update a single plan's credits (admin only).
 */
export async function updatePlanCredits(
  token: string,
  planId: string,
  newCredits: number
): Promise<PricingConfig> {
  const admin = await verifyAdmin();
  const config = await getPricingConfig();

  const planIndex = config.plans.findIndex(p => p.id === planId);
  if (planIndex === -1) {
    throw new Error(`Plan not found: ${planId}`);
  }

  config.plans[planIndex].credits = newCredits;

  return updatePricingConfig(token, config);
}

/**
 * Toggle a plan's active status (admin only).
 */
export async function togglePlanActive(
  token: string,
  planId: string
): Promise<PricingConfig> {
  const admin = await verifyAdmin();
  const config = await getPricingConfig();

  const planIndex = config.plans.findIndex(p => p.id === planId);
  if (planIndex === -1) {
    throw new Error(`Plan not found: ${planId}`);
  }

  config.plans[planIndex].isActive = !config.plans[planIndex].isActive;

  return updatePricingConfig(token, config);
}
