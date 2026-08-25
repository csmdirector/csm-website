import Stripe from 'stripe';
import {
  createPaymentExperimentService,
  createPostgresPaymentExperimentRepository,
  isPreviewDeployment,
  isStripeTestSecret,
  parseExperimentSlot
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

export default async function pianoCsmPaymentSession(req) {
  if (!isPreviewDeployment(env('CONTEXT'))) {
    return json({ ok: false, disabled: true, error: 'This endpoint is restricted to preview deployments.' }, 404);
  }
  if (!enabled(env('ENABLE_PIANO_CSM_PAYMENT_EXPERIMENT'))) {
    return json({ ok: false, disabled: true, error: 'CSM payment experiment is disabled.' }, 404);
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  const requestOrigin = new URL(req.url).origin;
  if (req.headers.get('origin') !== requestOrigin) {
    return json({ ok: false, error: 'Cross-origin payment initiation is not allowed.' }, 403);
  }

  const secretKey = env('STRIPE_SECRET_KEY_TEST');
  if (!isStripeTestSecret(secretKey)) {
    return json({ ok: false, error: 'A Stripe test-mode key is required. Live keys are rejected.' }, 503);
  }
  const slot = parseExperimentSlot(env('PIANO_CSM_PAYMENT_TEST_SLOT_JSON'));
  if (!slot) return json({ ok: false, error: 'No verified future preview slot is configured.' }, 503);

  let body;
  try {
    body = await req.json();
  } catch (error) {
    return json({ ok: false, error: 'A JSON request body is required.' }, 400);
  }

  const stripe = new Stripe(secretKey, { maxNetworkRetries: 0 });
  const service = createPaymentExperimentService({
    repository: createPostgresPaymentExperimentRepository(),
    slot,
    origin: requestOrigin,
    createCheckoutSession: ({ params, idempotencyKey }) => stripe.checkout.sessions.create(
      params,
      { idempotencyKey }
    )
  });
  const result = await service(body);
  return json(result, result.ok ? 200 : result.status || 500);
}

export const config = {
  path: '/api/piano-csm-payment-session'
};
