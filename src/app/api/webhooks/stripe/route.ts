import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/server/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { saveUserUsagePolicy } from '@/lib/usage-policy';

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
  return new Stripe(key, { apiVersion: '2026-02-25.clover' });
}

function getSubscriptionCurrentPeriodEnd(subscription: Stripe.Subscription): number {
  return subscription.items.data.reduce((latest, item) => (
    Math.max(latest, item.current_period_end ?? 0)
  ), 0);
}

// ---------------------------------------------------------------------------
// Firestore helpers
// ---------------------------------------------------------------------------

async function activateSubscription(
  uid: string,
  subscriptionId: string,
  customerId: string,
  currentPeriodEnd: number, // Unix seconds
): Promise<void> {
  const db = getAdminDb();
  await db
    .collection('users')
    .doc(uid)
    .collection('subscriptionStatus')
    .doc('current')
    .set(
      {
        isActive: true,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        planId: 'standard',
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

  // Sync usage policy to 'standard' (30 generations / month)
  await saveUserUsagePolicy(uid, null, { planId: 'standard' }, 'stripe-webhook');
}

async function updateSubscription(
  uid: string,
  subscriptionId: string,
  currentPeriodEnd: number,
  cancelAtPeriodEnd: boolean,
): Promise<void> {
  const db = getAdminDb();
  await db
    .collection('users')
    .doc(uid)
    .collection('subscriptionStatus')
    .doc('current')
    .set(
      {
        stripeSubscriptionId: subscriptionId,
        currentPeriodEnd,
        cancelAtPeriodEnd,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
}

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
        cancelAtPeriodEnd: false,
        planId: 'free',
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

  // Downgrade usage policy to 'free'
  await saveUserUsagePolicy(uid, null, { planId: 'free' }, 'stripe-webhook');
}

// ---------------------------------------------------------------------------
// Resolve Firebase UID from a Stripe event object
// ---------------------------------------------------------------------------

function resolveUid(obj: {
  metadata?: Stripe.Metadata | null;
  client_reference_id?: string | null;
}): string | null {
  return (
    obj.metadata?.firebaseUid ||
    obj.client_reference_id ||
    null
  );
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/stripe
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not set.');
    return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 500 });
  }

  const body = await req.text();
  const sig = req.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const uid = resolveUid(session);

        if (!uid) {
          console.warn('[Stripe Webhook] checkout.session.completed: no Firebase UID in metadata.');
          break;
        }

        // Retrieve full subscription to get currentPeriodEnd
        if (typeof session.subscription === 'string') {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await activateSubscription(
            uid,
            sub.id,
            typeof session.customer === 'string' ? session.customer : '',
            getSubscriptionCurrentPeriodEnd(sub),
          );
          console.info(`[Stripe Webhook] Activated subscription for uid=${uid}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const uid = resolveUid(sub);
        if (!uid) {
          console.warn('[Stripe Webhook] customer.subscription.updated: no Firebase UID.');
          break;
        }
        await updateSubscription(
          uid,
          sub.id,
          getSubscriptionCurrentPeriodEnd(sub),
          sub.cancel_at_period_end,
        );
        console.info(`[Stripe Webhook] Updated subscription for uid=${uid}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const uid = resolveUid(sub);
        if (!uid) {
          console.warn('[Stripe Webhook] customer.subscription.deleted: no Firebase UID.');
          break;
        }
        await deactivateSubscription(uid);
        console.info(`[Stripe Webhook] Deactivated subscription for uid=${uid}`);
        break;
      }

      default:
        // Unhandled event type — acknowledge without action
        break;
    }
  } catch (err) {
    console.error('[Stripe Webhook] Handler error:', err);
    return NextResponse.json({ error: 'Internal webhook handler error.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
