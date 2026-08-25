import Stripe from 'stripe';
import {
  createPianoIntroReconciler,
  createPostgresReconciliationRepository,
  isEnabled
} from './_shared/piano-intro-reconciliation.js';

function env(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
    const value = Netlify.env.get(name);
    if (value) return value;
  }
  if (typeof process !== 'undefined' && process.env) return process.env[name] || '';
  return '';
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export function verifyStripeEvent(rawBody, signature, secret, tolerance = 300) {
  if (!signature || !secret) throw new Error('Stripe webhook verification is not configured.');
  return Stripe.webhooks.constructEvent(rawBody, signature, secret, tolerance);
}

export default async function pianoIntroStripeReconciliation(req) {
  if (!isEnabled(env('ENABLE_PIANO_INTRO_RECONCILIATION'))) {
    return jsonResponse({ ok: false, disabled: true, error: 'Piano Intro reconciliation is disabled.' }, 404);
  }
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);

  const rawBody = await req.text();
  let event;
  try {
    event = verifyStripeEvent(
      rawBody,
      req.headers.get('stripe-signature') || '',
      env('PIANO_INTRO_RECONCILIATION_STRIPE_WEBHOOK_SECRET')
    );
  } catch (error) {
    console.error('piano-intro-stripe-reconciliation: signature verification failed', error);
    return jsonResponse({ ok: false, error: 'Invalid Stripe signature.' }, 400);
  }

  if (!['customer.updated', 'payment_intent.succeeded'].includes(event.type)) {
    return jsonResponse({ ok: true, ignored: true, event_type: event.type });
  }

  try {
    const repository = createPostgresReconciliationRepository();
    const reconciler = createPianoIntroReconciler({ repository });
    const result = await reconciler(event, {}, { source: 'stripe' });
    return jsonResponse({
      ok: true,
      event_id: result.event_id,
      duplicate: Boolean(result.duplicate),
      reconciliation_status: result.reconciliation_status,
      matched_csm_lead_id: result.matched_csm_lead_id || undefined,
      recovered_paid_events: result.recovered_paid_events || undefined,
      recovered_matched_csm_lead_id: result.recovered_matched_csm_lead_id || undefined,
      reason: result.reason || undefined
    });
  } catch (error) {
    console.error('piano-intro-stripe-reconciliation: processing failed', error);
    return jsonResponse({ ok: false, error: 'Stripe event could not be reconciled.' }, 500);
  }
}

export const config = {
  path: '/api/piano-intro-stripe-reconciliation'
};

export const testables = { verifyStripeEvent };
