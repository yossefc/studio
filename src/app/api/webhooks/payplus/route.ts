/**
 * POST /api/webhooks/payplus
 *
 * Receives IPN (Instant Payment Notifications) from PayPlus after each
 * successful charge or subscription event.
 *
 * PayPlus sends a POST request with a JSON body to this URL.
 * Configure the IPN URL in the PayPlus dashboard under:
 *   Settings → Notification URLs → IPN URL
 *
 * Expected IPN fields (main ones):
 *   transaction_uid        — unique ID for this transaction
 *   status_code            — "000" = success, anything else = failure
 *   transaction_type       — "REGULAR" | "RECURRING_FIRST" | "RECURRING"
 *                            | "SUBSCRIPTION_CANCELLED"
 *   client_reference_uid   — Firebase UID (passed when creating the payment link)
 *   payment_sum            — amount charged
 *   credit_card_token      — stored card token (usable for future charges)
 *
 * Signature verification:
 *   PayPlus computes HMAC-SHA256(rawBody, PAYPLUS_WEBHOOK_SECRET) and sends
 *   it in the "X-Payplus-Hash" header.
 *   Set PAYPLUS_WEBHOOK_SECRET in your .env to the value provided by PayPlus
 *   (dashboard → Settings → Webhook Secret).
 *
 * ⚠️  Important: verify the exact header name and hash algorithm with the
 *   PayPlus API documentation for your account tier before going live.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getAdminAuth, getAdminDb } from '@/server/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { saveUserUsagePolicy } from '@/lib/usage-policy';

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifyPayPlusSignature(rawBody: string, receivedSignature: string): boolean {
  const secret = process.env.PAYPLUS_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[PayPlus Webhook] PAYPLUS_WEBHOOK_SECRET not set.');
    return false;
  }
  if (!receivedSignature) {
    console.error('[PayPlus Webhook] No signature header received.');
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(receivedSignature, 'hex'),
    );
  } catch {
    // Buffer lengths differ → signatures don't match
    return false;
  }
}

// ---------------------------------------------------------------------------
// Firebase UID verification
// ---------------------------------------------------------------------------

/**
 * Verifies that the uid corresponds to a real Firebase Auth user.
 * Returns true if the user exists, false otherwise.
 * We return 200 (not 400) on unknown uid to avoid PayPlus retrying forever
 * for a phantom UID that will never exist.
 */
async function firebaseUserExists(uid: string): Promise<boolean> {
  try {
    await getAdminAuth().getUser(uid);
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'auth/user-not-found') return false;
    // Re-throw unexpected errors (network, quota, etc.) so the webhook retries
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Firestore helpers
// ---------------------------------------------------------------------------

/**
 * Activates the subscription for a user after the first successful payment.
 * Sets isActive=true, stores the PayPlus token, and upgrades the usage plan.
 */
async function activateSubscription(
  uid: string,
  transactionUid: string,
  recurringToken: string | null,
  currentPeriodEnd: number, // Unix timestamp (seconds)
  paymentSum: number,
): Promise<void> {
  const db = getAdminDb();
  const statusRef = db.collection('users').doc(uid).collection('subscriptionStatus').doc('current');
  const userRef = db.collection('users').doc(uid);

  // Idempotency: use a transaction to check if this transactionUid was already processed.
  // PayPlus retries webhooks on 5xx / timeout — must not double-count.
  let alreadyProcessed = false;
  await db.runTransaction(async (tx) => {
    const statusSnap = await tx.get(statusRef);
    if (statusSnap.exists && statusSnap.data()?.payplusTransactionUid === transactionUid) {
      alreadyProcessed = true;
      return;
    }
    tx.set(statusRef, {
      isActive: true,
      payplusTransactionUid: transactionUid,
      payplusRecurringToken: recurringToken ?? null,
      currentPeriodEnd,
      planId: 'standard',
      updatedAt: Timestamp.now(),
    }, { merge: true });
    if (paymentSum > 0) {
      tx.set(userRef, { totalSpent: FieldValue.increment(Math.max(0, paymentSum)) }, { merge: true });
    }
  });

  if (alreadyProcessed) {
    console.info(`[PayPlus Webhook] activateSubscription: transactionUid=${transactionUid} already processed — skipping.`);
    return;
  }

  // Upgrade usage policy to 'standard' plan (30 generations/month)
  await saveUserUsagePolicy(uid, null, { planId: 'standard' }, 'payplus-webhook');
}

/**
 * Renews the subscription after each successful monthly charge.
 * Extends currentPeriodEnd without changing other fields.
 */
async function renewSubscription(
  uid: string,
  transactionUid: string,
  currentPeriodEnd: number,
  paymentSum: number,
): Promise<void> {
  const db = getAdminDb();
  const statusRef = db.collection('users').doc(uid).collection('subscriptionStatus').doc('current');
  const userRef = db.collection('users').doc(uid);

  let alreadyProcessed = false;
  await db.runTransaction(async (tx) => {
    const statusSnap = await tx.get(statusRef);
    if (statusSnap.exists && statusSnap.data()?.payplusTransactionUid === transactionUid) {
      alreadyProcessed = true;
      return;
    }
    tx.set(statusRef, {
      isActive: true,
      payplusTransactionUid: transactionUid,
      currentPeriodEnd,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    if (paymentSum > 0) {
      tx.set(userRef, { totalSpent: FieldValue.increment(Math.max(0, paymentSum)) }, { merge: true });
    }
  });

  if (alreadyProcessed) {
    console.info(`[PayPlus Webhook] renewSubscription: transactionUid=${transactionUid} already processed — skipping.`);
  }
}

/**
 * Deactivates the subscription (cancellation or failed renewal).
 * Downgrades the usage policy to 'free'.
 */
async function deactivateSubscription(uid: string): Promise<void> {
  const db = getAdminDb();
  await db
    .collection('users')
    .doc(uid)
    .collection('subscriptionStatus')
    .doc('current')
    .set(
      {
        isActive: false,
        planId: 'free',
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

  // Downgrade usage policy to 'free'
  await saveUserUsagePolicy(uid, null, { planId: 'free' }, 'payplus-webhook');
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Read raw body (required for signature verification)
  const rawBody = await req.text();

  // 2. Verify signature
  // PayPlus sends the HMAC-SHA256 signature in the "X-Payplus-Hash" header.
  // Check your PayPlus dashboard / documentation for the exact header name.
  const signature = req.headers.get('x-payplus-hash') ?? '';

  if (!verifyPayPlusSignature(rawBody, signature)) {
    console.error('[PayPlus Webhook] Signature verification failed.');
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  // 3. Parse JSON body
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.error('[PayPlus Webhook] Invalid JSON body.');
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  // 4. Extract fields
  const statusCode       = String(payload.status_code       ?? '').trim();
  const transactionType  = String(payload.transaction_type  ?? '').trim().toUpperCase();
  const uid              = String(payload.client_reference_uid ?? '').trim();
  const transactionUid   = String(payload.transaction_uid   ?? '').trim();
  const recurringToken   = typeof payload.credit_card_token === 'string'
    ? payload.credit_card_token
    : null;
  const paymentSum       = typeof payload.payment_sum === 'number'
    ? payload.payment_sum
    : parseFloat(String(payload.payment_sum ?? '0')) || 0;

  console.info(
    `[PayPlus Webhook] Received: type=${transactionType} status=${statusCode} uid=${uid}`,
  );

  // 5. Handle subscription cancellation (does not require status "000")
  if (transactionType === 'SUBSCRIPTION_CANCELLED') {
    if (!uid) {
      console.warn('[PayPlus Webhook] SUBSCRIPTION_CANCELLED: missing client_reference_uid.');
      return NextResponse.json({ received: true });
    }
    if (!await firebaseUserExists(uid)) {
      console.warn(`[PayPlus Webhook] SUBSCRIPTION_CANCELLED: uid=${uid} not found in Firebase Auth — ignoring.`);
      return NextResponse.json({ received: true });
    }
    try {
      await deactivateSubscription(uid);
      console.info(`[PayPlus Webhook] Deactivated subscription for uid=${uid}`);
    } catch (err) {
      console.error('[PayPlus Webhook] deactivateSubscription error:', err);
      return NextResponse.json({ error: 'Internal error.' }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // 6. Only process successful payments from here
  if (statusCode !== '000') {
    console.info(`[PayPlus Webhook] Non-success status_code=${statusCode} — skipping.`);
    return NextResponse.json({ received: true });
  }

  if (!uid) {
    console.warn('[PayPlus Webhook] Missing client_reference_uid in successful payment.');
    return NextResponse.json({ error: 'Missing client_reference_uid.' }, { status: 400 });
  }

  // 7. Verify the uid corresponds to a real Firebase Auth user before any write.
  if (!await firebaseUserExists(uid)) {
    console.warn(`[PayPlus Webhook] uid=${uid} not found in Firebase Auth — ignoring payment.`);
    // Return 200 so PayPlus does not retry indefinitely for a phantom UID.
    return NextResponse.json({ received: true });
  }

  // 8. currentPeriodEnd: PayPlus does not return the next billing date explicitly.
  //    We calculate it as now + 31 days (1 extra day as a grace period).
  //    Adjust if your billing cycle differs (e.g. quarterly → 92 days).
  const currentPeriodEnd = Math.floor(Date.now() / 1000) + 31 * 24 * 60 * 60;

  try {
    if (transactionType === 'RECURRING_FIRST' || transactionType === 'REGULAR') {
      // First payment → activate subscription and store recurring token
      await activateSubscription(uid, transactionUid, recurringToken, currentPeriodEnd, paymentSum);
      console.info(`[PayPlus Webhook] Activated subscription for uid=${uid}`);
    } else if (transactionType === 'RECURRING') {
      // Subsequent monthly charge → extend subscription period
      await renewSubscription(uid, transactionUid, currentPeriodEnd, paymentSum);
      console.info(`[PayPlus Webhook] Renewed subscription for uid=${uid}`);
    } else {
      console.info(`[PayPlus Webhook] Unhandled transaction_type=${transactionType} — skipping.`);
    }
  } catch (err) {
    console.error('[PayPlus Webhook] Handler error:', err);
    return NextResponse.json({ error: 'Internal webhook handler error.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
