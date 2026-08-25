import Stripe from 'stripe';
import {
  applyStripeCheckoutEvent,
  createPostgresPaymentEventRepository,
  isPreviewDeployment,
  isStripeTestSecret
} from './_shared/piano-csm-payment-experiment.js';

function env(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
    return Netlify.env.get(name) || '';
  }
  if (typeof process !== 'undefined' && process.env) return process.env[name] || '';
  return '';
}

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async function pianoCsmPaymentWebhook(req) {
  if (!isPreviewDeployment(env('CONTEXT'))) {
    return json({ ok: false, disabled: true }, 404);
  }
  if (!enabled(env('ENABLE_PIANO_CSM_PAYMENT_EXPERIMENT'))) {
    return json({ ok: false, disabled: true }, 404);
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  const secretKey = env('STRIPE_SECRET_KEY_TEST');
  const webhookSecret = env('STRIPE_PIANO_CSM_PAYMENT_WEBHOOK_SECRET_TEST');
  if (!isStripeTestSecret(secretKey) || !/^whsec_/.test(webhookSecret)) {
    return json({ ok: false, error: 'Stripe test webhook configuration is incomplete.' }, 503);
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return json({ ok: false, error: 'Missing Stripe signature.' }, 400);
  const rawBody = await req.text();
  const stripe = new Stripe(secretKey, { maxNetworkRetries: 0 });
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    return json({ ok: false, error: 'Invalid Stripe webhook signature.' }, 400);
  }

  const result = await applyStripeCheckoutEvent({
    event,
    repository: createPostgresPaymentEventRepository()
  });
  return json(result, result.ok || result.ignored ? 200 : 409);
}

export const config = {
  path: '/api/piano-csm-payment-webhook'
};
