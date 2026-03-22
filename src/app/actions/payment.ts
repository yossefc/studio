'use server';

/**
 * Server Actions — PayPlus payment integration.
 *
 * PayPlus (payplus.co.il) is an Israeli payment gateway supporting:
 *   - Credit cards, Bit, PayPal
 *   - Recurring subscriptions (managed in PayPlus dashboard)
 *   - Token-based future charges
 *
 * API documentation: https://www.payplus.co.il/api-documentation
 */

import { getAuthenticatedUser } from '@/lib/server-auth';
import { getAdminDb } from '@/server/firebase-admin';

const PAYPLUS_BASE_URL = 'https://restapi.payplus.co.il/api/v1.0';

/**
 * Builds the Authorization header for PayPlus requests.
 * Format: "{api_key}.{secret_key}"
 */
function getPayPlusHeaders(): HeadersInit {
  const apiKey = process.env.PAYPLUS_API_KEY;
  const secretKey = process.env.PAYPLUS_SECRET_KEY;
  if (!apiKey || !secretKey) {
    throw new Error('PAYPLUS_API_KEY or PAYPLUS_SECRET_KEY not configured.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `${apiKey}.${secretKey}`,
  };
}

// ---------------------------------------------------------------------------
// createCheckoutSession
// Generates a PayPlus payment page URL and returns it to the client.
// The client is then redirected to this URL to complete payment (Bit / card).
// ---------------------------------------------------------------------------

export async function createCheckoutSession(): Promise<
  { url: string } | { error: string }
> {
  try {
    const authUser = await getAuthenticatedUser();
    const pageUid = process.env.PAYPLUS_PAGE_UID;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    if (!pageUid) {
      return { error: 'PAYPLUS_PAGE_UID not configured.' };
    }

    /**
     * PayPlus generateLink payload.
     *
     * Notes:
     * - payment_page_uid: created in the PayPlus dashboard (Checkout Pages section)
     *   Configure the page to enable Bit and set the recurring plan there.
     * - client_reference_uid: the Firebase UID — returned verbatim in the IPN
     *   so we can identify the user without storing a separate mapping.
     * - payment_methods: ['credit_card', 'bit'] enables both methods on the page.
     *   Bit support requires activation in the PayPlus dashboard.
     * - For recurring subscriptions, configure the billing cycle directly on the
     *   payment page template in the dashboard ("תשלומים חוזרים / מנוי").
     */
    const payload = {
      payment_page_uid: pageUid,
      charge_total: 14,       // 14₪/month — must match the price in the dashboard
      currency_code: 'ILS',
      refURL_success: `${appUrl}/generate?subscription=success`,
      refURL_failure: `${appUrl}/generate?subscription=cancelled`,
      client_reference_uid: authUser.uid,
      customer: {
        customer_name: authUser.email ?? '',
        email: authUser.email ?? '',
      },
      items: [
        {
          name: 'TalmudAI — מנוי חודשי',
          quantity: 1,
          price: 14,
          vat_type: 1, // 1 = VAT included (default in Israel)
        },
      ],
      // Enable both credit card and Bit on the hosted payment page.
      // Remove 'bit' if your PayPlus account does not have Bit activated.
      payment_methods: ['credit_card', 'bit'],
    };

    const res = await fetch(`${PAYPLUS_BASE_URL}/PaymentPages/generateLink`, {
      method: 'POST',
      headers: getPayPlusHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[PayPlus] generateLink HTTP error:', res.status, text);
      return { error: `PayPlus error (${res.status})` };
    }

    const data = (await res.json()) as {
      results?: {
        status: number;
        description: string;
        payment_page_link?: string;
      };
    };

    if (!data.results?.payment_page_link) {
      console.error('[PayPlus] No payment_page_link in response:', data);
      return {
        error: data.results?.description ?? 'PayPlus did not return a payment URL.',
      };
    }

    return { url: data.results.payment_page_link };
  } catch (err) {
    console.error('[PayPlus] createCheckoutSession error:', err);
    return { error: err instanceof Error ? err.message : 'Payment error.' };
  }
}

// ---------------------------------------------------------------------------
// checkSubscriptionStatus
// Reads the subscription state from Firestore — provider-agnostic.
// The webhook route is responsible for writing/updating this document.
// ---------------------------------------------------------------------------

export interface SubscriptionStatus {
  isActive: boolean;
  planId?: string;
  currentPeriodEnd?: number; // Unix timestamp in seconds
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
        typeof data.currentPeriodEnd === 'number'
          ? data.currentPeriodEnd
          : undefined,
    };
  } catch {
    // Not authenticated or Firestore error — treat as not subscribed
    return { isActive: false };
  }
}
