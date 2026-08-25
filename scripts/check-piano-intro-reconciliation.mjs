import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PIANO_INTRO_AMOUNT_CENTS,
  PIANO_INTRO_SERVICE_ID,
  chooseReconciliationMatch,
  createPianoIntroReconciler,
  eventDedupeKey,
  extractOpusEvidence,
  extractStripeEvidence
} from '../netlify/functions/_shared/piano-intro-reconciliation.js';
import { testables as stripeWebhookTestables } from '../netlify/functions/piano-intro-stripe-reconciliation.js';
import Stripe from 'stripe';

const clientPayload = {
  trigger: 'client_create_trigger',
  client: {
    id: 'opus-client-acceptance-1',
    parent1_email: 'Piano.Reconcile+acceptance@gmail.com',
    parent1_primary_phone: '(513) 555-0242',
    parent1_first_name: 'Fake',
    parent1_last_name: 'Reconcile Parent',
    student: {
      id: 'opus-student-acceptance-1',
      first_name: 'Fake',
      last_name: 'Reconcile Student'
    }
  }
};

const paidIntroPayload = {
  trigger: 'subscription_create_trigger',
  subscription: {
    id: 'opus-subscription-acceptance-1',
    client_id: 'opus-client-acceptance-1',
    status: 'active',
    payment_status: 'paid',
    amount_total: 42,
    currency: 'USD',
    paid_at: '2026-08-11T16:10:00Z',
    start_at: '2026-08-20T20:00:00Z',
    service: {
      id: PIANO_INTRO_SERVICE_ID,
      name: 'Piano Private Intro Lesson - 30 mins'
    },
    location: { name: 'CSM Mason' },
    booking: { id: 'opus-booking-acceptance-1' }
  }
};

const clientEvidence = extractOpusEvidence(clientPayload);
assert.equal(clientEvidence.eventType, 'client_create');
assert.equal(clientEvidence.parentEmailNorm, 'pianoreconcile@gmail.com');
assert.equal(clientEvidence.parentPhoneNorm, '+15135550242');
assert.equal(clientEvidence.opusClientId, 'opus-client-acceptance-1');
assert.equal(clientEvidence.opusStudentId, 'opus-student-acceptance-1');
assert.equal(clientEvidence.verifiedPaidIntro, false);

const paidEvidence = extractOpusEvidence(paidIntroPayload);
assert.equal(paidEvidence.eventType, 'subscription_create');
assert.equal(paidEvidence.opusSubscriptionId, 'opus-subscription-acceptance-1');
assert.equal(paidEvidence.opusBookingId, 'opus-booking-acceptance-1');
assert.equal(paidEvidence.serviceId, PIANO_INTRO_SERVICE_ID);
assert.equal(paidEvidence.amountCents, PIANO_INTRO_AMOUNT_CENTS);
assert.equal(paidEvidence.currency, 'usd');
assert.equal(paidEvidence.bookingStatus, 'booked');
assert.equal(paidEvidence.paymentStatus, 'paid');
assert.equal(paidEvidence.verifiedPaidIntro, true);
assert.equal(eventDedupeKey(paidEvidence, paidIntroPayload), eventDedupeKey(paidEvidence, paidIntroPayload));

const flatClientEvidence = extractOpusEvidence({
  id: 'flat-opus-client-1',
  first_name: 'Fake',
  last_name: 'Parent',
  email: 'flat.parent@example.com',
  primary_phone: '(513) 555-0242'
}, { 'x-opus-trigger': 'client_create_trigger' });
assert.equal(flatClientEvidence.eventType, 'client_create');
assert.equal(flatClientEvidence.opusClientId, 'flat-opus-client-1');
assert.equal(flatClientEvidence.parentEmailNorm, 'flat.parent@example.com');
assert.equal(flatClientEvidence.verifiedPaidIntro, false);

const baseLead = {
  csm_lead_id: 'CSM-PRE-20260811-ACCEPT01',
  parent_email_norm: 'pianoreconcile@gmail.com',
  parent_phone_norm: '+15135550242',
  student_name: 'Fake Reconcile Student',
  preferred_location: 'CSM Mason',
  preferred_location_slug: 'mason',
  submitted_at: '2026-08-11T16:00:00Z',
  existing_family: false,
  reconciliation_status: 'pending',
  attribution: { utm_source: 'google', utm_medium: 'cpc', gclid: 'acceptance-click-id' },
  attribution_summary: 'Source: Google Ads\nClick ID: acceptance-click-id'
};

const stripeCustomerEvent = {
  id: 'evt_customer_acceptance',
  type: 'customer.updated',
  created: 1786639283,
  data: {
    object: {
      id: 'cus_acceptance',
      object: 'customer',
      description: 'Fake Reconcile Parent',
      email: 'Piano.Reconciliation.Acceptance.20260811.1@yd3bhcva.mailosaur.net',
      metadata: {
        id: 'opus-client-acceptance-1',
        business: 'cincinnatischoolofmusic'
      }
    }
  }
};

const stripePaidEvent = {
  id: 'evt_paid_acceptance',
  type: 'payment_intent.succeeded',
  created: 1786642248,
  data: {
    object: {
      id: 'pi_acceptance',
      object: 'payment_intent',
      amount: 4200,
      amount_received: 4200,
      currency: 'usd',
      customer: 'cus_acceptance',
      description: 'Piano Private Intro Lesson - 30 mins - Single Visit - Intro',
      status: 'succeeded',
      metadata: {
        business: 'cincinnatischoolofmusic',
        location_id: '369181cc-4cd8-40a5-95c5-89eca189d55d',
        order_id: 'order-acceptance-1'
      }
    }
  }
};

const stripeIdentity = extractStripeEvidence(stripeCustomerEvent);
assert.equal(stripeIdentity.parentEmailNorm, 'piano.reconciliation.acceptance.20260811.1@yd3bhcva.mailosaur.net');
assert.equal(stripeIdentity.opusClientId, 'opus-client-acceptance-1');
assert.equal(stripeIdentity.stripeCustomerId, 'cus_acceptance');
assert.equal(stripeIdentity.verifiedPaidIntro, false);

const stripePaid = extractStripeEvidence(stripePaidEvent);
assert.equal(stripePaid.stripePaymentIntentId, 'pi_acceptance');
assert.equal(stripePaid.opusBookingId, 'order-acceptance-1');
assert.equal(stripePaid.amountCents, 4200);
assert.equal(stripePaid.bookingStatus, 'booked');
assert.equal(stripePaid.paymentStatus, 'paid');
assert.equal(stripePaid.verifiedPaidIntro, true);

assert.equal(chooseReconciliationMatch({
  evidence: { ...paidEvidence, ...clientEvidence },
  emailCandidates: [baseLead],
  phoneCandidates: [baseLead],
  eventAt: paidEvidence.paidAt
}).action, 'match');

assert.deepEqual(chooseReconciliationMatch({
  evidence: { ...paidEvidence, ...clientEvidence },
  emailCandidates: [baseLead, { ...baseLead, csm_lead_id: 'CSM-PRE-20260811-ACCEPT02' }],
  phoneCandidates: [baseLead],
  eventAt: paidEvidence.paidAt
}), {
  action: 'manual_review',
  reason: 'multiple_exact_email_candidates',
  candidateLeadIds: ['CSM-PRE-20260811-ACCEPT01', 'CSM-PRE-20260811-ACCEPT02']
});

assert.equal(chooseReconciliationMatch({
  evidence: { ...paidEvidence, ...clientEvidence, parentPhoneNorm: '+15135550999' },
  emailCandidates: [baseLead],
  phoneCandidates: [],
  eventAt: paidEvidence.paidAt
}).reason, 'phone_conflict_after_email_match');

class MemoryRepository {
  constructor(leads = []) {
    this.leads = leads.map((lead) => structuredClone(lead));
    this.events = [];
    this.nextId = 1;
  }

  async createEvent({ dedupeKey, evidence, payload }) {
    const duplicate = this.events.find((event) => event.dedupe_key === dedupeKey);
    if (duplicate) return { record: duplicate, created: false };
    const record = {
      id: this.nextId++,
      dedupe_key: dedupeKey,
      evidence: structuredClone(evidence),
      payload: structuredClone(payload),
      reconciliation_status: 'received',
      matched_csm_lead_id: null
    };
    this.events.push(record);
    return { record, created: true };
  }

  async updateEvent(eventId, values) {
    const event = this.events.find((item) => item.id === eventId);
    Object.assign(event, {
      evidence: structuredClone(values.evidence || event.evidence),
      reconciliation_status: values.status,
      reconciliation_reason: values.reason || null,
      match_method: values.matchMethod || null,
      matched_csm_lead_id: values.leadId || null,
      process_error: values.error || null
    });
    return event;
  }

  async identityEvidence(opusClientId, beforeEventId) {
    return this.events
      .filter((event) => event.id !== beforeEventId && event.evidence.opusClientId === opusClientId)
      .map((event) => event.evidence);
  }

  async stripeIdentityEvidence(stripeCustomerId, beforeEventId) {
    return this.events
      .filter((event) => event.id !== beforeEventId && event.evidence.stripeCustomerId === stripeCustomerId)
      .map((event) => event.evidence);
  }

  async candidates(emailNorm, phoneNorm) {
    const available = this.leads.filter((lead) => lead.reconciliation_status !== 'matched_paid');
    return {
      emailCandidates: available.filter((lead) => emailNorm && lead.parent_email_norm === emailNorm),
      phoneCandidates: available.filter((lead) => phoneNorm && lead.parent_phone_norm === phoneNorm)
    };
  }

  async alreadyMatched(evidence) {
    return this.leads.find((lead) => lead.reconciliation_status === 'matched_paid' && (
      (evidence.opusSubscriptionId && lead.matched_opus_subscription_id === evidence.opusSubscriptionId) ||
      (evidence.opusBookingId && lead.matched_opus_booking_id === evidence.opusBookingId)
    )) || null;
  }

  async markManual(leadIds, reason) {
    this.leads.filter((lead) => leadIds.includes(lead.csm_lead_id)).forEach((lead) => {
      lead.reconciliation_status = lead.existing_family ? 'existing_family_office' : 'manual_review';
      lead.reconciliation_reason = reason;
      lead.reconciliation_manual_review_required = true;
      lead.office_follow_up_required = true;
    });
    return leadIds;
  }

  async markMatched(leadId, eventId, evidence, method) {
    const lead = this.leads.find((item) => item.csm_lead_id === leadId);
    lead.reconciliation_status = 'matched_paid';
    lead.reconciliation_match_method = method;
    lead.reconciliation_reason = 'verified_paid_opus_piano_intro';
    lead.reconciliation_manual_review_required = false;
    lead.matched_opus_event_id = eventId;
    lead.matched_opus_client_id = evidence.opusClientId;
    lead.matched_opus_student_id = evidence.opusStudentId;
    lead.matched_opus_subscription_id = evidence.opusSubscriptionId;
    lead.matched_opus_booking_id = evidence.opusBookingId;
    lead.opus_booking_status = 'booked';
    lead.opus_payment_status = 'paid';
    lead.opus_amount_cents = evidence.amountCents;
    lead.opus_currency = evidence.currency;
    lead.reconciliation_evidence = structuredClone(evidence);
    return lead;
  }
}

const repository = new MemoryRepository([baseLead]);
const reconcile = createPianoIntroReconciler({ repository });
const identityResult = await reconcile(clientPayload);
assert.equal(identityResult.reconciliation_status, 'identity_observed');
assert.equal(repository.leads[0].reconciliation_status, 'pending');

const originalAttribution = structuredClone(repository.leads[0].attribution);
const paidResult = await reconcile(paidIntroPayload);
assert.equal(paidResult.reconciliation_status, 'matched_paid');
assert.equal(paidResult.match_method, 'email');
assert.equal(paidResult.matched_csm_lead_id, baseLead.csm_lead_id);
assert.equal(repository.leads[0].opus_booking_status, 'booked');
assert.equal(repository.leads[0].opus_payment_status, 'paid');
assert.equal(repository.leads[0].opus_amount_cents, 4200);
assert.deepEqual(repository.leads[0].attribution, originalAttribution);
assert.equal(repository.leads[0].attribution_summary, baseLead.attribution_summary);

const stripeLead = {
  ...baseLead,
  csm_lead_id: 'CSM-PRE-20260811-STRIPE01',
  parent_email_norm: 'piano.reconciliation.acceptance.20260811.1@yd3bhcva.mailosaur.net'
};
const stripeRepository = new MemoryRepository([stripeLead]);
const stripeReconcile = createPianoIntroReconciler({ repository: stripeRepository });
const stripePaidFirst = await stripeReconcile(stripePaidEvent, {}, { source: 'stripe' });
assert.equal(stripePaidFirst.reconciliation_status, 'manual_review');
assert.equal(stripePaidFirst.reason, 'missing_exact_email_and_phone');
stripeRepository.leads[0].reconciliation_status = 'pending';
stripeRepository.leads[0].reconciliation_reason = null;
stripeRepository.leads[0].reconciliation_manual_review_required = false;
const stripeIdentitySecond = await stripeReconcile(stripeCustomerEvent, {}, { source: 'stripe' });
assert.equal(stripeIdentitySecond.reconciliation_status, 'identity_observed');
const replayPaid = { ...stripePaidEvent, id: 'evt_paid_acceptance_replay' };
const stripeMatched = await stripeReconcile(replayPaid, {}, { source: 'stripe' });
assert.equal(stripeMatched.reconciliation_status, 'matched_paid');
assert.equal(stripeMatched.match_method, 'email');
assert.equal(stripeRepository.leads[0].matched_opus_client_id, 'opus-client-acceptance-1');
assert.equal(stripeRepository.leads[0].matched_opus_booking_id, 'order-acceptance-1');
assert.deepEqual(stripeRepository.leads[0].attribution, stripeLead.attribution);

const stripeSecret = 'whsec_unit_test_only';
const stripeRaw = JSON.stringify(stripePaidEvent);
const stripeSignature = Stripe.webhooks.generateTestHeaderString({ payload: stripeRaw, secret: stripeSecret });
assert.equal(stripeWebhookTestables.verifyStripeEvent(stripeRaw, stripeSignature, stripeSecret).id, stripePaidEvent.id);
assert.throws(() => stripeWebhookTestables.verifyStripeEvent(stripeRaw, stripeSignature, 'whsec_wrong'));

const duplicateResult = await reconcile(paidIntroPayload);
assert.equal(duplicateResult.duplicate, true);
assert.equal(repository.events.length, 2);

const unverifiedRepository = new MemoryRepository([{ ...baseLead, csm_lead_id: 'CSM-PRE-20260811-UNPAID01' }]);
const unverifiedReconcile = createPianoIntroReconciler({ repository: unverifiedRepository });
await unverifiedReconcile(clientPayload);
const unverified = await unverifiedReconcile({
  ...paidIntroPayload,
  subscription: {
    ...paidIntroPayload.subscription,
    id: 'unpaid-subscription',
    payment_status: 'pending',
    paid_at: null
  }
});
assert.notEqual(unverified.reconciliation_status, 'matched_paid');
assert.equal(unverifiedRepository.leads[0].reconciliation_status, 'pending');

const functionSource = readFileSync(new URL('../netlify/functions/piano-intro-reconciliation.js', import.meta.url), 'utf8');
assert.match(functionSource, /ENABLE_PIANO_INTRO_RECONCILIATION/);
assert.match(functionSource, /PIANO_INTRO_RECONCILIATION_OPUS_TOKEN/);
assert.match(functionSource, /searchParams\.get\('trigger'\)/);
assert.match(functionSource, /event_id/);
assert.match(functionSource, /events.*===.*'1'/);
assert.doesNotMatch(functionSource, /OPUS_INBOUND_WEBHOOK|people\/create|client_create.*fetch/i);

const stripeFunctionSource = readFileSync(new URL('../netlify/functions/piano-intro-stripe-reconciliation.js', import.meta.url), 'utf8');
assert.match(stripeFunctionSource, /constructEvent/);
assert.match(stripeFunctionSource, /PIANO_INTRO_RECONCILIATION_STRIPE_WEBHOOK_SECRET/);
assert.match(stripeFunctionSource, /payment_intent\.succeeded/);
assert.match(stripeFunctionSource, /customer\.updated/);
assert.doesNotMatch(stripeFunctionSource, /client_create|paymentIntents\.create|charges\.create/);

const preregPage = readFileSync(new URL('../src/pages/book-piano-intro/index.astro', import.meta.url), 'utf8');
assert.doesNotMatch(preregPage, /piano-intro-reconciliation|client_create|csm-payment-experiment/);
assert.doesNotMatch(preregPage, /dataLayer\.push/);

const migration = readFileSync(
  new URL('../netlify/database/migrations/20260811021500_create_piano_intro_reconciliation.sql', import.meta.url),
  'utf8'
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS piano_intro_opus_events/);
assert.match(migration, /reconciliation_status text NOT NULL DEFAULT 'pending'/);
assert.match(migration, /opus_booking_status text NOT NULL DEFAULT 'unverified'/);
assert.match(migration, /opus_payment_status text NOT NULL DEFAULT 'unverified'/);
const stripeMigration = readFileSync(
  new URL('../netlify/database/migrations/20260813143000_add_stripe_customer_reconciliation_index.sql', import.meta.url),
  'utf8'
);
assert.match(stripeMigration, /stripeCustomerId/);

console.log('Piano Intro reconciliation checks passed.');
