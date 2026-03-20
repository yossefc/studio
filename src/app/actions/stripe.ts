'use server';

import Stripe from 'stripe';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { getAdminDb } from '@/server/firebase-admin';

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
  return new Stripe(key, { apiVersion: '2026-02-25.clover' });
}

// ---------------------------------------------------------------------------
// createStripeCheckoutSession
// ---------------------------------------------------------------------------

export async function createStripeCheckoutSession(): Promise<
  { url: string } | { error: string }
> {
  try {
    const authUser = await getAuthenticatedUser();
    const priceId = process.env.STRIPE_PRICE_ID_MONTHLY;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    if (!priceId) {
      return { error: 'Stripe price not configured.' };
    }

    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        firebaseUid: authUser.uid,
        firebaseEmail: authUser.email ?? '',
      },
      client_reference_id: authUser.uid,
      customer_email: authUser.email ?? undefined,
      success_url: `${appUrl}/generate?subscription=success`,
      cancel_url: `${appUrl}/generate?subscription=cancelled`,
      locale: 'auto',
    });

    if (!session.url) {
      return { error: 'Stripe did not return a checkout URL.' };
    }

    return { url: session.url };
  } catch (err) {
    console.error('[Stripe] createStripeCheckoutSession error:', err);
    return { error: err instanceof Error ? err.message : 'Stripe error.' };
  }
}

// ---------------------------------------------------------------------------
// checkSubscriptionStatus
// ---------------------------------------------------------------------------

export interface SubscriptionStatus {
  isActive: boolean;
  planId?: string;
  currentPeriodEnd?: number; // Unix timestamp (seconds)
  cancelAtPeriodEnd?: boolean;
}

export async function checkSubscriptionStatus(): Promise<SubscriptionStatus> {
  try {
    const authUser = await getAuthenticatedUser();
    const db = getAdminDb();

    const snap = await db
      .collection('users')
      .doc(authUser.uid)
      .collection('subscriptionStatus')
      .doc('current')
      .get();

    if (!snap.exists) {
      return { isActive: false };
    }

    const data = snap.data()!;
    return {
      isActive: Boolean(data.isActive),
      planId: typeof data.planId === 'string' ? data.planId : undefined,
      currentPeriodEnd:
        typeof data.currentPeriodEnd === 'number' ? data.currentPeriodEnd : undefined,
      cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd),
    };
  } catch {
    // Not authenticated or Firestore error — treat as not subscribed
    return { isActive: false };
  }
}
