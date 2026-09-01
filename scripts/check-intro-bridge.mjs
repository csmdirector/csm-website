import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INTRO_LOCATIONS,
  INTRO_SERVICES,
  introBookingUrl,
  introBridgePath,
  introLocation,
  introService
} from '../shared/intro-bridge-config.js';
import {
  INTRO_BRIDGE_FORM,
  buildOfficeNotification,
  buildStudentNote,
  createIntroBridge,
  dedupeFingerprint,
  normalizeSubmission,
  validateSubmission
} from '../netlify/functions/_shared/intro-bridge.js';
import {
  chooseReconciliationMatch,
  extractOpusEvidence,
  extractStripeEvidence
} from '../netlify/functions/_shared/intro-reconciliation.js';
import { testables as submitTestables } from '../netlify/functions/intro-bridge-submit.js';

assert.equal(INTRO_SERVICES.length, 6);
assert.equal(INTRO_LOCATIONS.length, 5);
assert.deepEqual(Object.fromEntries(INTRO_SERVICES.map((item) => [item.slug, item.opusServiceId])), {
  piano: '567f7305-b997-46cd-b24b-60b129879ef8',
  'music-discovery': '7e24490c-de02-490f-a33b-18860c5e6c2c',
  guitar: 'e09f1dcd-3231-4502-970b-6314ca1cc898',
  voice: '95e7a5e8-1c0d-40a7-969a-d95e2add26ea',
  violin: '36269f6c-9092-4c9a-a6f9-d2f8688f4c85',
  drums: '3252333e-2590-4a98-937d-cd71b8d3934b'
});
assert.deepEqual(Object.fromEntries(INTRO_LOCATIONS.map((item) => [item.slug, item.opusLocationId])), {
  mason: '369181cc-4cd8-40a5-95c5-89eca189d55d',
  montgomery: '7d3034f0-01a9-4dbd-84a7-1dc9f5a601e4',
  anderson: '39fde686-237a-4a20-9039-e49976da2d8c',
  maineville: '45ec0927-58ad-40ee-9e07-f711b5306cb0',
  middletown: 'ae5eb81a-8b10-4286-a46e-987779ffbea7'
});
assert.equal(introService('mdl').slug, 'music-discovery');
assert.equal(introService('drum').slug, 'drums');
assert.equal(introLocation('CSM Mason').slug, 'mason');
assert.equal(introBridgePath({ service: 'voice', location: 'anderson' }), '/book-intro/?service=voice&location=anderson');
assert.equal(
  introBookingUrl('piano', 'mason'),
  'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-mason'
);
assert.equal(
  introBookingUrl('music-discovery', 'montgomery'),
  'https://cincinnatischoolofmusic.opus1.io/w/book-your-music-discovery-intro-montgomery'
);
const guitarMason = new URL(introBookingUrl('guitar', 'mason'));
assert.equal(guitarMason.pathname, '/selfbook');
assert.equal(guitarMason.searchParams.get('serviceId'), introService('guitar').opusServiceId);
assert.equal(guitarMason.searchParams.get('locationId'), introLocation('mason').opusLocationId);
assert.equal(guitarMason.searchParams.get('planName'), 'Single Visit - Intro');

assert.deepEqual(submitTestables.resolveConversionEligibility({ enabledValue: '', deployContext: 'deploy-preview' }), {
  conversionEligible: false,
  conversionExclusionReason: 'production_conversions_disabled:deploy-preview',
  deployContext: 'deploy-preview'
});
assert.equal(submitTestables.introBridgeEnabled({ enabledValue: '', deployContext: 'deploy-preview' }), true);
assert.equal(submitTestables.introBridgeEnabled({ enabledValue: '', deployContext: 'branch-deploy' }), true);
assert.equal(submitTestables.introBridgeEnabled({ enabledValue: '', deployContext: 'unknown', hostname: 'intro-bridge-preview--csm-website.netlify.app' }), true);
assert.equal(submitTestables.introBridgeEnabled({ enabledValue: '', deployContext: 'unknown', hostname: 'csm-website.netlify.app' }), false);
assert.equal(submitTestables.introBridgeEnabled({ enabledValue: '', deployContext: 'unknown', hostname: 'cincinnatischoolofmusic.com' }), false);
assert.equal(submitTestables.introBridgeEnabled({ enabledValue: '', deployContext: 'production' }), false);
assert.equal(submitTestables.introBridgeEnabled({ enabledValue: 'true', deployContext: 'production' }), true);

const base = {
  'form-name': INTRO_BRIDGE_FORM,
  client_submission_id: 'intro-bridge-local-test-0001',
  parent_name: 'Fake Parent',
  parent_email: 'fake.bridge@example.com',
  parent_phone: '+15135550169',
  student_name: 'Fake Student',
  student_age: '4',
  service_slug: 'music-discovery',
  preferred_location: 'mason',
  preferred_time_window: 'Weekday afternoons',
  existing_family: 'no',
  submitted_at: '2026-08-25T14:30:00.000Z',
  attribution_json: JSON.stringify({
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'music_discovery',
    gclid: 'TEST-INTRO-BRIDGE'
  })
};
const normalized = normalizeSubmission(base);
assert.equal(validateSubmission(normalized).ok, true);
assert.equal(normalized.service.slug, 'music-discovery');
assert.equal(validateSubmission(normalizeSubmission({ ...base, student_age: '7' })).ok, false);
assert.notEqual(
  dedupeFingerprint(normalized),
  dedupeFingerprint(normalizeSubmission({ ...base, service_slug: 'piano' }))
);
const note = buildStudentNote({ fields: normalized, leadId: 'CSM-PRE-20260825-BRIDGE01', submittedAt: normalized.submittedAt });
assert.match(note, /Instrument: Music Discovery/);
assert.match(note, /CSM lead ID: CSM-PRE-20260825-BRIDGE01/);

class MemoryRepository {
  constructor() { this.records = []; }
  async createLead(input) {
    const existing = this.records.find((item) => item.client_submission_id === input.clientSubmissionId);
    if (existing) return { record: existing, created: false, replay: true };
    const record = {
      csm_lead_id: input.leadId,
      client_submission_id: input.clientSubmissionId,
      parent_name: input.parentName,
      parent_email: input.parentEmail,
      parent_phone: input.parentPhone,
      student_name: input.studentName,
      student_age: input.studentAge,
      service_slug: input.serviceSlug,
      instrument: input.instrument,
      preferred_location: input.preferredLocation,
      preferred_location_slug: input.preferredLocationSlug,
      preferred_time_window: input.preferredTimeWindow,
      existing_family: input.existingFamily,
      booking_url: input.bookingUrl,
      attribution_summary: input.attributionSummary,
      student_note: input.studentNote,
      opus_post_status: input.existingFamily ? 'skipped_existing_family' : 'not_attempted_vanilla_handoff',
      office_follow_up_required: input.existingFamily,
      reconciliation_status: input.existingFamily ? 'existing_family_office' : 'pending',
      conversion_eligible: input.conversionEligible,
      conversion_exclusion_reason: input.conversionExclusionReason,
      submitted_at: input.submittedAt
    };
    this.records.push(record);
    return { record, created: true, replay: false };
  }
  async recordOfficeNotification(leadId, payload, result) {
    const record = this.records.find((item) => item.csm_lead_id === leadId);
    record.office_notification_status = result.status;
    record.office_notification_payload = payload;
    return record;
  }
}

const repository = new MemoryRepository();
const bridge = createIntroBridge({
  repository,
  config: { officeEmailEnabled: false, conversionEligible: false, conversionExclusionReason: 'non_production_test' },
  now: () => new Date('2026-08-25T14:30:01.000Z'),
  uuid: () => '12345678-2222-4333-8444-555555555555'
});
const result = await bridge(base);
assert.equal(result.stored, true);
assert.equal(result.service_slug, 'music-discovery');
assert.equal(result.instrument, 'Music Discovery');
assert.equal(result.booking_url, introBookingUrl('music-discovery', 'mason'));
assert.equal(result.conversion_eligible, false);
assert.equal(result.opus_client_create_attempted, false);
const notification = buildOfficeNotification(repository.records[0]);
assert.equal(notification['form-name'], INTRO_BRIDGE_FORM);
assert.equal(notification.service_slug, 'music-discovery');
assert.equal(notification.instrument, 'Music Discovery');

for (const service of INTRO_SERVICES) {
  assert.equal(service.priceCents, 0);
  assert.equal(service.paymentRequired, false);
  assert.deepEqual(service.acceptedPaidPriceCents, [4200]);
  const evidence = extractStripeEvidence({
    id: `evt_${service.slug}`,
    type: 'payment_intent.succeeded',
    created: 1787668200,
    data: { object: {
      id: `pi_${service.slug}`,
      object: 'payment_intent',
      amount: 4200,
      amount_received: 4200,
      currency: service.currency,
      customer: `cus_${service.slug}`,
      description: `${service.opusServiceName} - Single Visit - Intro`,
      status: 'succeeded',
      metadata: {
        business: 'cincinnatischoolofmusic',
        location_id: introLocation('mason').opusLocationId,
        order_id: `order_${service.slug}`
      }
    } }
  });
  assert.equal(evidence.serviceSlug, service.slug);
  assert.equal(evidence.supportedIntro, true);
  assert.equal(evidence.verifiedPaidIntro, true);

  const freeEvidence = extractOpusEvidence({
    trigger: 'subscription_create_trigger',
    subscription: {
      id: `sub_free_${service.slug}`,
      client_id: `client_free_${service.slug}`,
      status: 'active',
      amount_total: 0,
      currency: 'USD',
      service: { id: service.opusServiceId, name: service.opusServiceName },
      booking: { id: `booking_free_${service.slug}` }
    }
  });
  assert.equal(freeEvidence.serviceSlug, service.slug);
  assert.equal(freeEvidence.verifiedPaidIntro, false);
  assert.equal(freeEvidence.verifiedBookedFree, true);
  assert.equal(freeEvidence.paymentStatus, 'not_required');
}

const serviceConflict = chooseReconciliationMatch({
  evidence: {
    parentEmailNorm: 'fake.bridge@example.com',
    parentPhoneNorm: '+15135550169',
    serviceSlug: 'guitar',
    studentName: 'Fake Student',
    locationName: 'CSM Mason',
    paidAt: '2026-08-25T14:35:00.000Z'
  },
  emailCandidates: [{
    csm_lead_id: 'CSM-PRE-20260825-BRIDGE01',
    parent_email_norm: 'fake.bridge@example.com',
    parent_phone_norm: '+15135550169',
    student_name: 'Fake Student',
    service_slug: 'music-discovery',
    instrument: 'Music Discovery',
    preferred_location: 'CSM Mason',
    preferred_location_slug: 'mason',
    submitted_at: '2026-08-25T14:30:00.000Z',
    existing_family: false
  }],
  phoneCandidates: [],
  eventAt: '2026-08-25T14:35:00.000Z'
});
assert.equal(serviceConflict.action, 'manual_review');
assert.equal(serviceConflict.reason, 'service_conflict');

const page = readFileSync(new URL('../src/pages/book-intro/index.astro', import.meta.url), 'utf8');
assert.match(page, /name="service_slug"/);
assert.match(page, /\/api\/intro-bridge-submit/);
assert.match(page, /\/api\/intro-bridge-choice/);
assert.match(page, /data-step="1"/);
assert.match(page, /data-step="5"/);
assert.match(page, /id="locationNext"/);
assert.match(page, /Have Our Team Find a Fit/);
assert.match(page, /Free 30-minute intro · No ongoing commitment/);
assert.match(page, /Fall in Love With Music Special/);
assert.match(page, /Thanks—we’ve got your information/);
assert.doesNotMatch(page, /savedLeadReference|Reference CSM-PRE/);
assert.doesNotMatch(page, /\$42|enter payment/);
assert.doesNotMatch(page, /dataLayer\.push|purchase|generate_lead/);
const thankYou = readFileSync(new URL('../src/pages/book-intro/thank-you.astro', import.meta.url), 'utf8');
assert.match(thankYou, /without creating a duplicate account/);
assert.match(thankYou, /location\.bookingUrl/);
assert.match(thankYou, /Your intro lesson is free/);
assert.doesNotMatch(thankYou, /\$42|enter payment/);
const pianoPage = readFileSync(new URL('../src/pages/book-piano-intro/index.astro', import.meta.url), 'utf8');
assert.match(pianoPage, /Fall in Love With Music Special/);
assert.match(pianoPage, /A free 30-minute private piano intro lesson\./);
assert.doesNotMatch(pianoPage, /\$42|enter payment/);
const pianoThankYou = readFileSync(new URL('../src/pages/book-piano-intro/thank-you.astro', import.meta.url), 'utf8');
assert.match(pianoThankYou, /Your intro lesson is free/);
assert.doesNotMatch(pianoThankYou, /\$42|enter payment/);
const submitFunction = readFileSync(new URL('../netlify/functions/intro-bridge-submit.js', import.meta.url), 'utf8');
assert.match(submitFunction, /ENABLE_INTRO_BRIDGE/);
assert.doesNotMatch(submitFunction, /ENABLE_PIANO_PREREGISTRATION/);
const choiceFunction = readFileSync(new URL('../netlify/functions/intro-bridge-choice.js', import.meta.url), 'utf8');
assert.match(choiceFunction, /recordHandoffChoice/);
assert.match(choiceFunction, /HANDOFF_CHOICES\.OFFICE_HELP/);
assert.match(choiceFunction, /HANDOFF_CHOICES/);
const handoffMigration = readFileSync(new URL('../netlify/database/migrations/20260831193000_add-intro-handoff-choice/migration.sql', import.meta.url), 'utf8');
assert.match(handoffMigration, /handoff_choice/);
const netlifyConfig = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
assert.match(netlifyConfig, /\[context\.deploy-preview\.environment\][\s\S]*ENABLE_INTRO_BRIDGE = "true"/);
assert.match(netlifyConfig, /\[context\.branch-deploy\.environment\][\s\S]*ENABLE_INTRO_BRIDGE = "true"/);

for (const file of [
  'early-childhood-music-discovery-lessons.html',
  'guitar-lessons.html',
  'voice-lessons.html',
  'violin-lessons.html',
  'drum-lessons.html'
]) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /opus1\.io\/w\/book-your-(music-discovery|guitar|voice|violin|drum)-intro/);
  assert.match(source, /\/book-intro\/\?service=/);
}
const migration = readFileSync(new URL('../netlify/database/migrations/20260825143000_generalize_intro_bridge.sql', import.meta.url), 'utf8');
assert.match(migration, /service_slug text NOT NULL DEFAULT 'piano'/);
assert.match(migration, /piano_preregistrations_service_reconciliation_idx/);

console.log('Shared CSM → Opus Intro Bridge checks passed.');
