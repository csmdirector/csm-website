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

const freeIntroPayload = {
  trigger: 'subscription_create_trigger',
  subscription: {
    id: 'opus-subscription-free-acceptance-1',
    client_id: 'opus-client-acceptance-1',
    status: 'active',
    amount_total: 0,
    currency: 'USD',
    created_at: '2026-08-28T20:30:00Z',
    start_at: '2026-09-08T18:30:00Z',
    service: {
      id: '7e24490c-de02-490f-a33b-18860c5e6c2c',
      name: 'Music Discovery Intro Lesson - 30 min (ages 3-5)'
    },
    location: { name: 'CSM Montgomery' },
    booking: { id: 'opus-booking-free-acceptance-1' }
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

const prospectUpdatePayload = {
  id: 'opus-student-lifecycle-1',
  first_name: 'Fake',
  last_name: 'Lifecycle Student',
  status: 'Prospect (new)'
};
const bookedUpdatePayload = { ...prospectUpdatePayload, status: 'Intro Booked' };
const prospectUpdateEvidence = extractOpusEvidence(prospectUpdatePayload, { 'x-opus-trigger': 'client_update_trigger' });
const bookedUpdateEvidence = extractOpusEvidence(bookedUpdatePayload, { 'x-opus-trigger': 'client_update_trigger' });
assert.equal(
  eventDedupeKey(prospectUpdateEvidence, prospectUpdatePayload),
  eventDedupeKey(prospectUpdateEvidence, prospectUpdatePayload),
  'an identical client_update redelivery must dedupe'
);
assert.notEqual(
  eventDedupeKey(prospectUpdateEvidence, prospectUpdatePayload),
  eventDedupeKey(bookedUpdateEvidence, bookedUpdatePayload),
  'distinct lifecycle updates for one Opus client must not dedupe each other'
);

const freeEvidence = extractOpusEvidence(freeIntroPayload);
assert.equal(freeEvidence.eventType, 'subscription_create');
assert.equal(freeEvidence.serviceSlug, 'music-discovery');
assert.equal(freeEvidence.amountCents, 0);
assert.equal(freeEvidence.bookingStatus, 'booked');
assert.equal(freeEvidence.paymentStatus, 'not_required');
assert.equal(freeEvidence.verifiedPaidIntro, false);
assert.equal(freeEvidence.verifiedBookedFree, true);
assert.equal(freeEvidence.verifiedIntroCompletion, true);

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
  service_slug: 'piano',
  instrument: 'Piano',
  preferred_location: 'CSM Mason',
  preferred_location_slug: 'mason',
  submitted_at: '2026-08-11T16:00:00Z',
  existing_family: false,
  reconciliation_status: 'pending',
  conversion_eligible: true,
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
assert.equal(stripePaid.externalId, 'pi_acceptance');
assert.equal(
  eventDedupeKey(stripePaid, stripePaidEvent),
  eventDedupeKey(extractStripeEvidence({ ...stripePaidEvent, id: 'evt_same_payment_redelivered' }), { ...stripePaidEvent, id: 'evt_same_payment_redelivered' })
);

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

assert.equal(chooseReconciliationMatch({
  evidence: { ...paidEvidence, parentEmailNorm: '', parentPhoneNorm: baseLead.parent_phone_norm },
  emailCandidates: [],
  phoneCandidates: [baseLead],
  eventAt: paidEvidence.paidAt
}).method, 'phone');

assert.equal(chooseReconciliationMatch({
  evidence: { ...paidEvidence, parentEmailNorm: '', parentPhoneNorm: baseLead.parent_phone_norm },
  emailCandidates: [],
  phoneCandidates: [baseLead, { ...baseLead, csm_lead_id: 'CSM-PRE-20260811-PHONE02' }],
  eventAt: paidEvidence.paidAt
}).reason, 'multiple_exact_phone_candidates');

assert.equal(chooseReconciliationMatch({
  evidence: { ...paidEvidence, parentEmailNorm: baseLead.parent_email_norm, parentPhoneNorm: '+15135550999' },
  emailCandidates: [baseLead],
  phoneCandidates: [{ ...baseLead, csm_lead_id: 'CSM-PRE-20260811-OTHER01', parent_email_norm: 'other@example.com', parent_phone_norm: '+15135550999' }],
  eventAt: paidEvidence.paidAt
}).reason, 'phone_conflict_after_email_match');

assert.deepEqual(chooseReconciliationMatch({
  evidence: { ...paidEvidence, parentEmailNorm: '', parentPhoneNorm: '', parentName: baseLead.parent_name, studentName: baseLead.student_name },
  emailCandidates: [],
  phoneCandidates: [],
  eventAt: paidEvidence.paidAt
}), {
  action: 'manual_review',
  reason: 'missing_exact_email_and_phone',
  candidateLeadIds: []
});

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

  async reprocessablePaidEvents(identity, beforeEventId) {
    return this.events.filter((event) =>
      event.id !== beforeEventId &&
      !event.matched_csm_lead_id &&
      ['received', 'manual_review', 'verified_no_match'].includes(event.reconciliation_status) &&
      (event.evidence.verifiedPaidIntro === true || event.evidence.verifiedBookedFree === true) &&
      ((identity.stripeCustomerId && event.evidence.stripeCustomerId === identity.stripeCustomerId) ||
        (identity.opusClientId && event.evidence.opusClientId === identity.opusClientId))
    );
  }

  async candidates(emailNorm, phoneNorm) {
    const available = this.leads.filter((lead) => !['matched_paid', 'matched_booked_free'].includes(lead.reconciliation_status));
    return {
      emailCandidates: available.filter((lead) => emailNorm && lead.parent_email_norm === emailNorm),
      phoneCandidates: available.filter((lead) => phoneNorm && lead.parent_phone_norm === phoneNorm)
    };
  }

  async alreadyMatched(evidence) {
    return this.leads.find((lead) => ['matched_paid', 'matched_booked_free'].includes(lead.reconciliation_status) && (
      (evidence.opusSubscriptionId && lead.matched_opus_subscription_id === evidence.opusSubscriptionId) ||
      (evidence.opusBookingId && lead.matched_opus_booking_id === evidence.opusBookingId)
    )) || null;
  }

  async markManual(leadIds, reason) {
    this.leads.filter((lead) => leadIds.includes(lead.csm_lead_id) && !['matched_paid', 'matched_booked_free'].includes(lead.reconciliation_status)).forEach((lead) => {
      lead.reconciliation_status = lead.existing_family ? 'existing_family_office' : 'manual_review';
      lead.reconciliation_reason = reason;
      lead.reconciliation_manual_review_required = true;
      lead.office_follow_up_required = true;
    });
    return leadIds;
  }

  async markMatched(leadId, eventId, evidence, method) {
    const lead = this.leads.find((item) => item.csm_lead_id === leadId);
    lead.reconciliation_status = evidence.verifiedBookedFree ? 'matched_booked_free' : 'matched_paid';
    lead.reconciliation_match_method = method;
    lead.reconciliation_reason = evidence.verifiedBookedFree
      ? 'verified_free_opus_intro_booking'
      : evidence.serviceSlug === 'piano'
        ? 'verified_paid_opus_piano_intro'
        : 'verified_paid_opus_intro';
    lead.reconciliation_manual_review_required = false;
    lead.matched_opus_event_id = eventId;
    lead.matched_opus_client_id = evidence.opusClientId;
    lead.matched_opus_student_id = evidence.opusStudentId;
    lead.matched_opus_subscription_id = evidence.opusSubscriptionId;
    lead.matched_opus_booking_id = evidence.opusBookingId;
    lead.opus_booking_status = 'booked';
    lead.opus_payment_status = evidence.verifiedBookedFree ? 'not_required' : 'paid';
    lead.opus_amount_cents = evidence.amountCents ?? (evidence.verifiedBookedFree ? 0 : null);
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

const freeLead = {
  ...baseLead,
  csm_lead_id: 'CSM-PRE-20260828-FREE0001',
  service_slug: 'music-discovery',
  instrument: 'Music Discovery',
  preferred_location: 'CSM Montgomery',
  preferred_location_slug: 'montgomery',
  submitted_at: '2026-08-28T20:16:22Z',
  conversion_eligible: false
};
const freeRepository = new MemoryRepository([freeLead]);
const freeReconcile = createPianoIntroReconciler({ repository: freeRepository });
await freeReconcile(clientPayload);
const freeResult = await freeReconcile(freeIntroPayload);
assert.equal(freeResult.reconciliation_status, 'matched_booked_free');
assert.equal(freeResult.match_method, 'email');
assert.equal(freeResult.matched_csm_lead_id, freeLead.csm_lead_id);
assert.equal(freeRepository.leads[0].opus_booking_status, 'booked');
assert.equal(freeRepository.leads[0].opus_payment_status, 'not_required');
assert.equal(freeRepository.leads[0].opus_amount_cents, 0);
assert.equal(freeRepository.leads[0].conversion_eligible, false);
assert.deepEqual(freeRepository.leads[0].attribution, freeLead.attribution);

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
const stripeIdentitySecond = await stripeReconcile(stripeCustomerEvent, {}, { source: 'stripe' });
assert.equal(stripeIdentitySecond.reconciliation_status, 'identity_observed');
assert.equal(stripeIdentitySecond.recovered_paid_events, 1);
assert.equal(stripeIdentitySecond.recovered_matched_csm_lead_id, stripeLead.csm_lead_id);
const stripeMatched = await stripeReconcile(stripePaidEvent, {}, { source: 'stripe' });
assert.equal(stripeMatched.duplicate, true);
assert.equal(stripeMatched.reconciliation_status, 'matched_paid');
assert.equal(stripeRepository.leads[0].matched_opus_client_id, 'opus-client-acceptance-1');
assert.equal(stripeRepository.leads[0].matched_opus_booking_id, 'order-acceptance-1');
assert.deepEqual(stripeRepository.leads[0].attribution, stripeLead.attribution);

const phoneLead = {
  ...baseLead,
  csm_lead_id: 'CSM-PRE-20260811-PHONE01',
  parent_email_norm: 'phone-fallback-lead@example.com',
  parent_phone_norm: '+15135550242'
};
const phoneRepository = new MemoryRepository([phoneLead]);
const phoneReconcile = createPianoIntroReconciler({ repository: phoneRepository });
const phonePaidEvent = {
  ...stripePaidEvent,
  id: 'evt_paid_phone',
  data: { object: {
    ...stripePaidEvent.data.object,
    id: 'pi_phone',
    customer: 'cus_phone',
    metadata: { ...stripePaidEvent.data.object.metadata, order_id: 'order-phone' }
  } }
};
const phoneCustomerEvent = {
  ...stripeCustomerEvent,
  id: 'evt_customer_phone',
  data: { object: {
    ...stripeCustomerEvent.data.object,
    id: 'cus_phone',
    email: null,
    metadata: { ...stripeCustomerEvent.data.object.metadata, id: 'opus-client-phone' }
  } }
};
const phoneOpusIdentity = {
  ...clientPayload,
  client: {
    ...clientPayload.client,
    id: 'opus-client-phone',
    parent1_email: '',
    parent1_primary_phone: '(513) 555-0242'
  }
};
await phoneReconcile(phonePaidEvent, {}, { source: 'stripe' });
await phoneReconcile(phoneOpusIdentity);
const phoneIdentityResult = await phoneReconcile(phoneCustomerEvent, {}, { source: 'stripe' });
assert.equal(phoneIdentityResult.recovered_matched_csm_lead_id, phoneLead.csm_lead_id);
assert.equal(phoneRepository.leads[0].reconciliation_match_method, 'phone');

const nonPianoRepository = new MemoryRepository([{ ...baseLead, csm_lead_id: 'CSM-PRE-20260811-NONPIANO' }]);
const nonPianoReconcile = createPianoIntroReconciler({ repository: nonPianoRepository });
const nonPianoEvent = {
  ...stripePaidEvent,
  id: 'evt_paid_guitar',
  data: { object: {
    ...stripePaidEvent.data.object,
    id: 'pi_guitar',
    description: 'Guitar Private Intro Lesson - 30 mins - Single Visit - Intro',
    metadata: { ...stripePaidEvent.data.object.metadata, order_id: 'order-guitar' }
  } }
};
const nonPianoResult = await nonPianoReconcile(nonPianoEvent, {}, { source: 'stripe' });
assert.equal(nonPianoResult.reconciliation_status, 'manual_review');
assert.equal(nonPianoResult.reason, 'missing_exact_email_and_phone');
assert.equal(nonPianoRepository.leads[0].reconciliation_status, 'pending');

const guitarLead = {
  ...baseLead,
  csm_lead_id: 'CSM-PRE-20260811-GUITAR01',
  service_slug: 'guitar',
  instrument: 'Guitar'
};
const guitarRepository = new MemoryRepository([guitarLead]);
const guitarReconcile = createPianoIntroReconciler({ repository: guitarRepository });
await guitarReconcile({
  ...clientPayload,
  client: { ...clientPayload.client, id: 'opus-client-guitar-1' }
});
const guitarResult = await guitarReconcile({
  ...paidIntroPayload,
  subscription: {
    ...paidIntroPayload.subscription,
    id: 'opus-subscription-guitar-1',
    client_id: 'opus-client-guitar-1',
    service: {
      id: 'e09f1dcd-3231-4502-970b-6314ca1cc898',
      name: 'Guitar Private Intro Lesson - 30 min'
    },
    booking: { id: 'opus-booking-guitar-1' }
  }
});
assert.equal(guitarResult.reconciliation_status, 'matched_paid');
assert.equal(guitarRepository.leads[0].reconciliation_reason, 'verified_paid_opus_intro');
assert.equal(guitarRepository.leads[0].opus_payment_status, 'paid');

const existingFamilyRepository = new MemoryRepository([{ ...baseLead, csm_lead_id: 'CSM-PRE-20260811-EXISTING', existing_family: true }]);
const existingFamilyReconcile = createPianoIntroReconciler({ repository: existingFamilyRepository });
await existingFamilyReconcile(clientPayload);
const existingFamilyResult = await existingFamilyReconcile({
  ...paidIntroPayload,
  subscription: { ...paidIntroPayload.subscription, id: 'existing-family-subscription', booking: { id: 'existing-family-booking' } }
});
assert.equal(existingFamilyResult.reconciliation_status, 'manual_review');
assert.equal(existingFamilyRepository.leads[0].reconciliation_status, 'existing_family_office');

const excludedRepository = new MemoryRepository([{ ...baseLead, csm_lead_id: 'CSM-PRE-20260811-EXCLUDED', conversion_eligible: false }]);
const excludedReconcile = createPianoIntroReconciler({ repository: excludedRepository });
await excludedReconcile(clientPayload);
const excludedResult = await excludedReconcile({
  ...paidIntroPayload,
  subscription: { ...paidIntroPayload.subscription, id: 'excluded-subscription', booking: { id: 'excluded-booking' } }
});
assert.equal(excludedResult.reconciliation_status, 'matched_paid');
assert.equal(excludedRepository.leads[0].conversion_eligible, false);

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
const hardeningMigration = readFileSync(
  new URL('../netlify/database/migrations/20260825073000_harden_piano_intro_reconciliation.sql', import.meta.url),
  'utf8'
);
assert.match(hardeningMigration, /conversion_eligible boolean NOT NULL DEFAULT true/);
assert.match(hardeningMigration, /matched_opus_booking_id/);

console.log('Piano Intro reconciliation checks passed.');
