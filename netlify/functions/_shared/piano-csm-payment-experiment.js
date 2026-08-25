import crypto from 'node:crypto';
import { getConnectionString } from '@netlify/database';
import pg from 'pg';

const { Pool } = pg;

export const PIANO_INTRO_AMOUNT_CENTS = 4200;
export const PIANO_INTRO_CURRENCY = 'usd';

let pool;

function env(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
    const value = Netlify.env.get(name);
    if (value) return value;
  }
  if (typeof process !== 'undefined' && process.env) return process.env[name] || '';
  return '';
}

export function isPreviewDeployment(value) {
  return new Set(['dev', 'deploy-preview', 'branch-deploy']).has(clean(value, 40).toLowerCase());
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

export function isStripeTestSecret(value) {
  return /^sk_test_[A-Za-z0-9_]+$/.test(clean(value, 500));
}

export function parseExperimentSlot(value, now = new Date()) {
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch (error) {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const slot = {
    id: clean(raw.id, 160),
    serviceId: clean(raw.service_id || raw.serviceId, 160),
    staffId: clean(raw.staff_id || raw.staffId, 160),
    staffName: clean(raw.staff_name || raw.staffName, 160),
    locationId: clean(raw.location_id || raw.locationId, 160),
    locationSlug: clean(raw.location_slug || raw.locationSlug, 80).toLowerCase(),
    locationName: clean(raw.location_name || raw.locationName, 160),
    startAt: clean(raw.start_at || raw.startAt, 80),
    endAt: clean(raw.end_at || raw.endAt, 80)
  };
  if (!slot.id || !slot.serviceId || !slot.staffId || !slot.locationId || !slot.locationSlug || !slot.startAt) {
    return null;
  }
  const start = new Date(slot.startAt);
  if (Number.isNaN(start.getTime()) || start <= now) return null;
  if (slot.endAt && Number.isNaN(new Date(slot.endAt).getTime())) return null;
  return slot;
}

export function normalizePaymentRequest(raw) {
  return {
    leadId: clean(raw?.lead_id || raw?.leadId, 64),
    slotId: clean(raw?.slot_id || raw?.slotId, 160)
  };
}

export function validatePaymentRequest(fields) {
  if (!/^CSM-PRE-\d{8}-[A-Z0-9]{8}$/.test(fields.leadId)) {
    return { ok: false, status: 422, error: 'A valid CSM pre-registration reference is required.' };
  }
  if (!fields.slotId) return { ok: false, status: 422, error: 'A verified lesson slot is required.' };
  return { ok: true };
}

export function paymentExperimentKey(leadId, slotId) {
  return `piano-intro-${crypto.createHash('sha256').update(`${leadId}|${slotId}`).digest('hex')}`;
}

export function buildCheckoutSessionParams({ lead, slot, origin }) {
  return {
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: lead.parent_email,
    client_reference_id: lead.csm_lead_id,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: PIANO_INTRO_CURRENCY,
        unit_amount: PIANO_INTRO_AMOUNT_CENTS,
        product_data: {
          name: 'Piano Intro Lesson — Preview Experiment',
          description: `${slot.locationName || lead.preferred_location} · ${slot.startAt}`
        }
      }
    }],
    success_url: `${origin}/book-piano-intro/csm-payment-success/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/book-piano-intro/csm-payment-experiment/?lead_id=${encodeURIComponent(lead.csm_lead_id)}&slot_id=${encodeURIComponent(slot.id)}&canceled=1`,
    metadata: {
      flow: 'csm_piano_intro_preview',
      csm_lead_id: lead.csm_lead_id,
      opus_post_status: lead.opus_post_status,
      slot_id: slot.id,
      location_slug: slot.locationSlug
    },
    payment_intent_data: {
      metadata: {
        flow: 'csm_piano_intro_preview',
        csm_lead_id: lead.csm_lead_id,
        slot_id: slot.id
      }
    }
  };
}

function publicResult(record, extra = {}) {
  return {
    ok: true,
    experiment_id: record.experiment_id,
    lead_id: record.csm_lead_id,
    status: record.payment_status,
    checkout_url: record.stripe_checkout_url || null,
    opus_fulfillment_status: record.opus_fulfillment_status,
    ...extra
  };
}

function existingExperimentResult(record) {
  if (record.payment_status === 'checkout_open' && record.stripe_checkout_url) {
    return publicResult(record, { reused: true });
  }
  if (record.payment_status === 'paid') {
    return publicResult(record, { reused: true });
  }
  const ambiguous = record.payment_status === 'stripe_session_unknown';
  return {
    ok: false,
    status: 409,
    experiment_id: record.experiment_id,
    lead_id: record.csm_lead_id,
    payment_status: record.payment_status,
    error: ambiguous
      ? 'A prior Stripe session attempt had an ambiguous outcome. It will not be retried automatically.'
      : 'A payment experiment already exists for this lead and slot; office review is required before another attempt.'
  };
}

export function createPaymentExperimentService({ repository, createCheckoutSession, slot, origin }) {
  return async function start(raw) {
    const fields = normalizePaymentRequest(raw);
    const validation = validatePaymentRequest(fields);
    if (!validation.ok) return validation;
    if (!slot || fields.slotId !== slot.id) {
      return { ok: false, status: 409, error: 'That slot is not configured as a verified preview slot.' };
    }

    const lead = await repository.findLead(fields.leadId);
    if (!lead) return { ok: false, status: 404, error: 'CSM pre-registration not found.' };
    if (lead.existing_family) {
      return { ok: false, status: 409, error: 'Existing-family records remain an office-assisted path in this experiment.' };
    }
    if (lead.opus_post_status !== 'succeeded') {
      return { ok: false, status: 409, error: 'Opus client creation must be confirmed before starting the payment experiment.' };
    }
    if (lead.preferred_location_slug !== slot.locationSlug) {
      return { ok: false, status: 409, error: 'The verified slot does not match the pre-registration location.' };
    }

    const idempotencyKey = paymentExperimentKey(lead.csm_lead_id, slot.id);
    const pending = await repository.createPending({
      experimentId: crypto.randomUUID(),
      leadId: lead.csm_lead_id,
      slot,
      idempotencyKey,
      amountCents: PIANO_INTRO_AMOUNT_CENTS,
      currency: PIANO_INTRO_CURRENCY
    });
    if (!pending.created) return existingExperimentResult(pending.record);

    try {
      const session = await createCheckoutSession({
        params: buildCheckoutSessionParams({ lead, slot, origin }),
        idempotencyKey
      });
      if (!session?.id || !session?.url || session.livemode !== false) {
        throw new Error('Stripe did not return a test-mode Checkout Session URL.');
      }
      const record = await repository.finishCheckoutSession(pending.record.experiment_id, session);
      return publicResult(record, { reused: false });
    } catch (error) {
      const unknown = /connection|timeout|socket|network/i.test(clean(error?.type || error?.message || error, 1000));
      await repository.failCheckoutSession(pending.record.experiment_id, {
        status: unknown ? 'stripe_session_unknown' : 'stripe_session_failed',
        error: clean(error?.message || error, 1000)
      });
      return {
        ok: false,
        status: unknown ? 504 : 502,
        error: unknown
          ? 'Stripe session creation had an ambiguous network outcome. It will not be retried automatically.'
          : 'Stripe test Checkout could not be started.'
      };
    }
  };
}

function postgresPool() {
  let connectionString = env('DATABASE_URL') || env('POSTGRES_URL') || env('NETLIFY_DATABASE_URL');
  if (!connectionString) {
    try {
      connectionString = getConnectionString();
    } catch (error) {
      connectionString = '';
    }
  }
  if (!connectionString) throw new Error('Netlify Database is not configured.');
  if (!pool) {
    const ssl = /sslmode=require|neon\.tech|supabase\./i.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined;
    pool = new Pool({ connectionString, ssl, max: 3 });
  }
  return pool;
}

export function createPostgresPaymentExperimentRepository() {
  const db = postgresPool();
  return {
    async findLead(leadId) {
      const result = await db.query(
        `SELECT csm_lead_id, parent_email, preferred_location, preferred_location_slug,
                existing_family, opus_post_status
         FROM piano_preregistrations
         WHERE csm_lead_id = $1`,
        [leadId]
      );
      return result.rows[0] || null;
    },

    async createPending(input) {
      const inserted = await db.query(
        `INSERT INTO piano_intro_payment_experiments (
           experiment_id, csm_lead_id, slot_id, slot_snapshot, idempotency_key,
           amount_cents, currency, payment_status, opus_fulfillment_status
         ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, 'session_creating', 'not_started')
         ON CONFLICT (csm_lead_id, slot_id) DO NOTHING
         RETURNING *`,
        [input.experimentId, input.leadId, input.slot.id, JSON.stringify(input.slot),
          input.idempotencyKey, input.amountCents, input.currency]
      );
      if (inserted.rows[0]) return { record: inserted.rows[0], created: true };
      const existing = await db.query(
        'SELECT * FROM piano_intro_payment_experiments WHERE csm_lead_id = $1 AND slot_id = $2',
        [input.leadId, input.slot.id]
      );
      return { record: existing.rows[0], created: false };
    },

    async finishCheckoutSession(experimentId, session) {
      const result = await db.query(
        `UPDATE piano_intro_payment_experiments
         SET payment_status = 'checkout_open', stripe_checkout_session_id = $2,
             stripe_checkout_url = $3, checkout_created_at = now(), updated_at = now()
         WHERE experiment_id = $1
         RETURNING *`,
        [experimentId, session.id, session.url]
      );
      return result.rows[0];
    },

    async failCheckoutSession(experimentId, result) {
      await db.query(
        `UPDATE piano_intro_payment_experiments
         SET payment_status = $2, stripe_error = $3, office_follow_up_required = true, updated_at = now()
         WHERE experiment_id = $1`,
        [experimentId, result.status, result.error]
      );
    }
  };
}

export function createPostgresPaymentEventRepository() {
  const db = postgresPool();
  return {
    async markPaid(input) {
      const result = await db.query(
        `UPDATE piano_intro_payment_experiments
         SET payment_status = 'paid', stripe_payment_intent_id = $2,
             last_stripe_event_id = $3, paid_at = COALESCE(paid_at, now()),
             opus_fulfillment_status = 'pending_manual',
             office_follow_up_required = true, updated_at = now()
         WHERE stripe_checkout_session_id = $1
           AND csm_lead_id = $4
           AND slot_id = $5
           AND (last_stripe_event_id IS NULL OR last_stripe_event_id <> $3)
         RETURNING experiment_id, csm_lead_id, payment_status, opus_fulfillment_status`,
        [input.sessionId, input.paymentIntentId, input.eventId, input.leadId, input.slotId]
      );
      if (result.rows[0]) return { ok: true, updated: true, record: result.rows[0] };
      return { ok: true, updated: false, duplicate_or_unknown: true };
    }
  };
}

export async function applyStripeCheckoutEvent({ event, repository }) {
  if (!event || event.livemode !== false || !event.id || !event.data?.object) {
    return { ok: false, ignored: true, reason: 'not_a_test_event' };
  }
  const supported = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
  if (!supported.has(event.type)) return { ok: true, ignored: true, reason: 'unsupported_event' };
  const session = event.data.object;
  if (session.metadata?.flow !== 'csm_piano_intro_preview') {
    return { ok: true, ignored: true, reason: 'different_flow' };
  }
  if (!session.id || !/^CSM-PRE-\d{8}-[A-Z0-9]{8}$/.test(session.metadata?.csm_lead_id || '') || !session.metadata?.slot_id) {
    return { ok: false, ignored: true, reason: 'missing_identity' };
  }
  if (session.payment_status !== 'paid' || session.currency !== PIANO_INTRO_CURRENCY || session.amount_total !== PIANO_INTRO_AMOUNT_CENTS) {
    return { ok: false, ignored: true, reason: 'payment_not_verified' };
  }
  return repository.markPaid({
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    eventId: event.id,
    leadId: session.metadata.csm_lead_id,
    slotId: session.metadata.slot_id
  });
}
