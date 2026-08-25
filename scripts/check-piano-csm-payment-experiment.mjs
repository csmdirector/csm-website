import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PIANO_INTRO_AMOUNT_CENTS,
  applyStripeCheckoutEvent,
  buildCheckoutSessionParams,
  createPaymentExperimentService,
  isPreviewDeployment,
  isStripeTestSecret,
  parseExperimentSlot,
  paymentExperimentKey
} from '../netlify/functions/_shared/piano-csm-payment-experiment.js';

assert.equal(isStripeTestSecret('sk_test_example_123'), true);
assert.equal(isStripeTestSecret('sk_live_example_123'), false);
assert.equal(isStripeTestSecret(''), false);
assert.equal(isPreviewDeployment('deploy-preview'), true);
assert.equal(isPreviewDeployment('branch-deploy'), true);
assert.equal(isPreviewDeployment('production'), false);

const slot = parseExperimentSlot({
  id: 'mason-nedra-2026-08-20T20:00:00Z',
  service_id: 'service-test',
  staff_id: 'staff-test',
  staff_name: 'Nedra Kaufman',
  location_id: 'location-test',
  location_slug: 'mason',
  location_name: 'CSM Mason',
  start_at: '2026-08-20T20:00:00.000Z',
  end_at: '2026-08-20T20:30:00.000Z'
}, new Date('2026-08-09T12:00:00.000Z'));
assert.ok(slot);
assert.equal(parseExperimentSlot('{not-json'), null);
assert.equal(parseExperimentSlot({ ...slot, start_at: '2020-01-01T00:00:00Z' }, new Date('2026-08-09')), null);

const lead = {
  csm_lead_id: 'CSM-PRE-20260809-TEST0001',
  parent_email: 'fake.parent@example.com',
  preferred_location: 'CSM Mason',
  preferred_location_slug: 'mason',
  existing_family: false,
  opus_post_status: 'succeeded'
};
const params = buildCheckoutSessionParams({ lead, slot, origin: 'https://preview.example.com' });
assert.equal(params.mode, 'payment');
assert.equal(params.line_items[0].price_data.unit_amount, PIANO_INTRO_AMOUNT_CENTS);
assert.equal(params.metadata.csm_lead_id, lead.csm_lead_id);
assert.equal(params.payment_intent_data.metadata.slot_id, slot.id);
assert.match(params.success_url, /\{CHECKOUT_SESSION_ID\}/);
assert.match(paymentExperimentKey(lead.csm_lead_id, slot.id), /^piano-intro-[a-f0-9]{64}$/);

class MemoryRepository {
  constructor(leadRecord = lead) {
    this.lead = leadRecord;
    this.records = [];
    this.events = [];
  }
  async findLead(id) { return id === this.lead?.csm_lead_id ? this.lead : null; }
  async createPending(input) {
    const existing = this.records.find((item) => item.csm_lead_id === input.leadId && item.slot_id === input.slot.id);
    if (existing) return { record: existing, created: false };
    const record = {
      experiment_id: input.experimentId,
      csm_lead_id: input.leadId,
      slot_id: input.slot.id,
      payment_status: 'session_creating',
      opus_fulfillment_status: 'not_started',
      stripe_checkout_url: null
    };
    this.records.push(record);
    return { record, created: true };
  }
  async finishCheckoutSession(id, session) {
    const record = this.records.find((item) => item.experiment_id === id);
    record.payment_status = 'checkout_open';
    record.stripe_checkout_session_id = session.id;
    record.stripe_checkout_url = session.url;
    return record;
  }
  async failCheckoutSession(id, result) {
    const record = this.records.find((item) => item.experiment_id === id);
    record.payment_status = result.status;
    record.stripe_error = result.error;
  }
  async markPaid(input) {
    this.events.push(input);
    const record = this.records.find((item) => item.stripe_checkout_session_id === input.sessionId);
    if (!record) return { ok: true, updated: false };
    record.payment_status = 'paid';
    record.opus_fulfillment_status = 'pending_manual';
    return { ok: true, updated: true, record };
  }
}

const repository = new MemoryRepository();
let sessionCalls = 0;
const service = createPaymentExperimentService({
  repository,
  slot,
  origin: 'https://preview.example.com',
  createCheckoutSession: async () => {
    sessionCalls += 1;
    return { id: 'cs_test_preview', url: 'https://checkout.stripe.com/c/pay/cs_test_preview', livemode: false };
  }
});
const first = await service({ lead_id: lead.csm_lead_id, slot_id: slot.id });
assert.equal(first.ok, true);
assert.equal(first.status, 'checkout_open');
assert.equal(first.reused, false);
const replay = await service({ lead_id: lead.csm_lead_id, slot_id: slot.id });
assert.equal(replay.reused, true);
assert.equal(sessionCalls, 1);

const blocked = createPaymentExperimentService({
  repository: new MemoryRepository({ ...lead, opus_post_status: 'unknown_timeout' }),
  slot,
  origin: 'https://preview.example.com',
  createCheckoutSession: async () => { throw new Error('must not run'); }
});
assert.equal((await blocked({ lead_id: lead.csm_lead_id, slot_id: slot.id })).status, 409);

const ambiguousRepository = new MemoryRepository();
let ambiguousCalls = 0;
const ambiguous = createPaymentExperimentService({
  repository: ambiguousRepository,
  slot,
  origin: 'https://preview.example.com',
  createCheckoutSession: async () => {
    ambiguousCalls += 1;
    throw new Error('network timeout');
  }
});
const ambiguousResult = await ambiguous({ lead_id: lead.csm_lead_id, slot_id: slot.id });
assert.equal(ambiguousResult.status, 504);
assert.equal(ambiguousCalls, 1);
assert.equal(ambiguousRepository.records[0].payment_status, 'stripe_session_unknown');
const unknownReplay = createPaymentExperimentService({
  repository: ambiguousRepository,
  slot,
  origin: 'https://preview.example.com',
  createCheckoutSession: async () => { throw new Error('must not retry'); }
});
assert.equal((await unknownReplay({ lead_id: lead.csm_lead_id, slot_id: slot.id })).status, 409);
assert.equal(ambiguousCalls, 1);

const paid = await applyStripeCheckoutEvent({
  repository,
  event: {
    id: 'evt_test_preview',
    type: 'checkout.session.completed',
    livemode: false,
    data: { object: {
      id: 'cs_test_preview',
      payment_status: 'paid',
      currency: 'usd',
      amount_total: 4200,
      payment_intent: 'pi_test_preview',
      metadata: {
        flow: 'csm_piano_intro_preview',
        csm_lead_id: lead.csm_lead_id,
        slot_id: slot.id
      }
    } }
  }
});
assert.equal(paid.updated, true);
assert.equal(repository.records[0].opus_fulfillment_status, 'pending_manual');

const liveIgnored = await applyStripeCheckoutEvent({
  repository,
  event: { id: 'evt_live', type: 'checkout.session.completed', livemode: true, data: { object: {} } }
});
assert.equal(liveIgnored.ignored, true);

const page = readFileSync(new URL('../src/pages/book-piano-intro/csm-payment-experiment.astro', import.meta.url), 'utf8');
assert.match(page, /Preview Architecture Experiment/);
assert.match(page, /opus_fulfillment_pending/);
assert.doesNotMatch(page, /dataLayer\s*\.\s*push|['"]purchase['"]|['"]generate_lead['"]/i);

const sessionFunction = readFileSync(new URL('../netlify/functions/piano-csm-payment-session.js', import.meta.url), 'utf8');
assert.match(sessionFunction, /STRIPE_SECRET_KEY_TEST/);
assert.match(sessionFunction, /maxNetworkRetries: 0/);
assert.match(sessionFunction, /isPreviewDeployment/);
assert.match(sessionFunction, /Cross-origin payment initiation is not allowed/);
assert.doesNotMatch(sessionFunction, /sk_live_/);

const migration = readFileSync(new URL('../netlify/database/migrations/20260809133000_create_piano_payment_experiments.sql', import.meta.url), 'utf8');
assert.match(migration, /CHECK \(amount_cents = 4200\)/);
assert.match(migration, /UNIQUE \(csm_lead_id, slot_id\)/);
assert.match(migration, /opus_fulfillment_status/);

console.log('Piano CSM payment experiment checks passed.');
