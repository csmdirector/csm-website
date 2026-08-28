import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PIANO_PREREGISTRATION_FORM,
  READY_BUYER_HANDOFF_MODE,
  buildOfficeNotification,
  buildStudentNote,
  createPianoPreregistrationBridge,
  normalizeSubmission,
  validateSubmission
} from '../netlify/functions/_shared/piano-preregistration.js';
import { testables as submitTestables } from '../netlify/functions/piano-preregistration-submit.js';
import { PIANO_BOOKING_LOCATIONS } from '../shared/piano-booking-links.js';

const conversionsDisabled = submitTestables.resolveConversionEligibility({
  enabledValue: '',
  deployContext: 'unknown'
});
assert.deepEqual(conversionsDisabled, {
  conversionEligible: false,
  conversionExclusionReason: 'production_conversions_disabled:unknown',
  deployContext: 'unknown'
});

const conversionsEnabled = submitTestables.resolveConversionEligibility({
  enabledValue: 'true',
  deployContext: 'production'
});
assert.deepEqual(conversionsEnabled, {
  conversionEligible: true,
  conversionExclusionReason: '',
  deployContext: 'production'
});

const bookingUrls = Object.fromEntries(PIANO_BOOKING_LOCATIONS.map((item) => [item.slug, item.bookingUrl]));
assert.deepEqual(bookingUrls, {
  montgomery: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-montgomery',
  mason: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-mason',
  anderson: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-anderson',
  maineville: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-maineville',
  middletown: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-middletown'
});

const baseRaw = {
  'form-name': PIANO_PREREGISTRATION_FORM,
  client_submission_id: 'piano-prereg-local-test-0001',
  parent_name: 'Fake Parent',
  parent_email: 'fake.parent@example.com',
  parent_phone: '+15135550147',
  student_name: 'Fake Student',
  student_birthdate: '2012-01-15',
  preferred_location: 'mason',
  preferred_time_window: 'Weekday afternoons',
  existing_family: 'no',
  submitted_at: '2026-08-10T12:00:00.000Z',
  attribution_json: JSON.stringify({
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'piano',
    utm_content: 'pre-registration',
    utm_term: 'piano lessons near me',
    gclid: 'fake-click-id',
    first_landing_path: '/book-piano-intro/?utm_source=google',
    latest_landing_path: '/book-piano-intro/'
  })
};

const normalized = normalizeSubmission(baseRaw);
assert.equal(validateSubmission(normalized).ok, true);
const note = buildStudentNote({
  fields: normalized,
  leadId: 'CSM-PRE-20260810-TEST0001',
  submittedAt: normalized.submittedAt
});
assert.match(note, /Source: Google Ads/);
assert.match(note, /Instrument: Piano/);
assert.match(note, /Preferred location: CSM Mason/);
assert.match(note, /Preferred time window: Weekday afternoons/);
assert.match(note, /CSM lead ID: CSM-PRE-20260810-TEST0001/);
assert.match(note, /normal Opus booking\/payment flow/);
assert.match(note, /did not pre-create an Opus parent or student/);

class MemoryRepository {
  constructor() {
    this.records = [];
  }

  async createLead(input) {
    const replay = this.records.find((record) => record.client_submission_id === input.clientSubmissionId);
    if (replay) return { record: replay, created: false, replay: true };
    const duplicate = this.records.find((record) => record.dedupe_fingerprint === input.dedupeFingerprint);
    const status = input.existingFamily
      ? 'skipped_existing_family'
      : duplicate
        ? 'not_attempted_recent_duplicate'
        : 'not_attempted_vanilla_handoff';
    const record = {
      csm_lead_id: input.leadId,
      client_submission_id: input.clientSubmissionId,
      parent_name: input.parentName,
      parent_email: input.parentEmail,
      parent_phone: input.parentPhone,
      student_name: input.studentName,
      student_birthdate: input.studentBirthdate,
      student_age: input.studentAge,
      preferred_location: input.preferredLocation,
      preferred_location_slug: input.preferredLocationSlug,
      preferred_time_window: input.preferredTimeWindow,
      existing_family: input.existingFamily,
      booking_url: input.bookingUrl,
      attribution_summary: input.attributionSummary,
      student_note: input.studentNote,
      dedupe_fingerprint: input.dedupeFingerprint,
      duplicate_of_lead_id: duplicate?.csm_lead_id || null,
      opus_payload: {},
      opus_post_status: status,
      opus_attempted_at: null,
      office_follow_up_required: input.existingFamily,
      office_notification_status: 'pending',
      submitted_at: input.submittedAt
    };
    this.records.push(record);
    return { record, created: true, replay: false };
  }

  async recordOfficeNotification(leadId, payload, result) {
    const record = this.records.find((item) => item.csm_lead_id === leadId);
    record.office_notification_status = result.status;
    record.office_notification_payload = payload;
    if (result.status !== 'sent') record.office_follow_up_required = true;
    return record;
  }
}

const repository = new MemoryRepository();
const officeNotifications = [];
let uuidCounter = 0;
let unexpectedNetworkCalls = 0;
const bridge = createPianoPreregistrationBridge({
  repository,
  // Legacy webhook settings are intentionally ignored by this ready-buyer bridge.
  config: {
    opusEnabled: true,
    opusUrl: 'https://api.opus1.io/hooks/should-never-run/people/create',
    opusToken: 'should-never-be-read',
    officeEmailEnabled: true
  },
  fetchImpl: async () => {
    unexpectedNetworkCalls += 1;
    throw new Error('The ready-buyer flow must not call the Opus inbound webhook.');
  },
  notifyOffice: async (payload) => officeNotifications.push(payload),
  now: () => new Date('2026-08-10T12:00:01.000Z'),
  uuid: () => `${String(++uuidCounter).padStart(8, '0')}-2222-4333-8444-555555555555`
});

const first = await bridge(baseRaw);
assert.equal(first.ok, true);
assert.equal(first.stored, true);
assert.equal(first.opus_post_status, 'not_attempted_vanilla_handoff');
assert.equal(first.handoff_mode, READY_BUYER_HANDOFF_MODE);
assert.equal(first.opus_client_create_attempted, false);
assert.equal(first.booking_url, bookingUrls.mason);
assert.equal(first.office_follow_up_required, false);
assert.equal(unexpectedNetworkCalls, 0);
assert.equal(officeNotifications.length, 1);
assert.equal(officeNotifications[0].csm_lead_id, first.lead_id);
assert.equal(officeNotifications[0].preferred_location, 'CSM Mason');
assert.equal(officeNotifications[0].handoff_mode, READY_BUYER_HANDOFF_MODE);
assert.equal(officeNotifications[0].opus_client_create_attempted, 'No');
assert.match(officeNotifications[0].attribution_summary, /Source: Google Ads/);

const replay = await bridge(baseRaw);
assert.equal(replay.replay, true);
assert.equal(unexpectedNetworkCalls, 0);
assert.equal(officeNotifications.length, 1);

const duplicate = await bridge({
  ...baseRaw,
  client_submission_id: 'piano-prereg-local-test-0002',
  submitted_at: '2026-08-10T12:04:00.000Z'
});
assert.equal(duplicate.stored, true);
assert.equal(duplicate.duplicate_detected, true);
assert.equal(duplicate.opus_post_status, 'not_attempted_recent_duplicate');
assert.equal(duplicate.opus_client_create_attempted, false);
assert.equal(unexpectedNetworkCalls, 0);
assert.equal(officeNotifications.length, 2);

const existingFamily = await bridge({
  ...baseRaw,
  client_submission_id: 'piano-prereg-local-test-0003',
  parent_email: 'existing@example.com',
  parent_phone: '+15135550148',
  existing_family: 'yes',
  preferred_location: 'anderson'
});
assert.equal(existingFamily.opus_post_status, 'skipped_existing_family');
assert.equal(existingFamily.opus_client_create_attempted, false);
assert.equal(existingFamily.office_follow_up_required, true);
assert.equal(existingFamily.booking_url, bookingUrls.anderson);
assert.equal(unexpectedNetworkCalls, 0);

const notification = buildOfficeNotification(repository.records[0]);
assert.equal(notification.booking_url, bookingUrls.mason);
assert.equal(notification.handoff_mode, READY_BUYER_HANDOFF_MODE);
assert.equal(notification.opus_client_create_attempted, 'No');
assert.match(notification.csm_context, /did not pre-create an Opus parent or student/);

const pageSource = readFileSync(new URL('../src/pages/book-piano-intro/index.astro', import.meta.url), 'utf8');
assert.doesNotMatch(pageSource, /dataLayer\.push/);
assert.doesNotMatch(pageSource, /google_ads_booking|purchase|generate_lead/i);
assert.match(pageSource, /Fall in Love With Music Special/);
assert.match(pageSource, /Start With a Free Piano Intro Lesson/);
assert.match(pageSource, /A free 30-minute private piano intro lesson\./);
assert.match(pageSource, /See Free Piano Intro Times/);
assert.doesNotMatch(pageSource, /\$42|enter payment/);
assert.match(pageSource, /No ongoing commitment\. You’re just booking the intro lesson\./);
assert.match(pageSource, /<span class="visually-hidden">General availability<\/span>/);
assert.doesNotMatch(pageSource, /Pre-Registration<\/span>|Save &amp; Continue to Times|Choose an Opus time|does not pre-create/);

const thankYouSource = readFileSync(new URL('../src/pages/book-piano-intro/thank-you.astro', import.meta.url), 'utf8');
assert.match(thankYouSource, /if\(existingFamily\)/);
assert.match(thankYouSource, /We’ll help you from here\./);
assert.match(thankYouSource, /without creating a duplicate account/);
assert.match(thankYouSource, /See Free ' \+ shortName \+ ' Piano Times/);
assert.match(thankYouSource, /Your intro lesson is free/);
assert.doesNotMatch(thankYouSource, /\$42|enter payment/);
assert.match(thankYouSource, /else if\(location\)/);
assert.match(thankYouSource, /\.choose-time\[hidden\]\{display:none\}/);
assert.doesNotMatch(thankYouSource, /Pre-Registration Saved|Choose a Time in Opus|office follow-up required|keeping you out/);

const submitSource = readFileSync(new URL('../netlify/functions/piano-preregistration-submit.js', import.meta.url), 'utf8');
assert.doesNotMatch(submitSource, /OPUS_INBOUND_WEBHOOK|OPUS_FORWARDING|people\/create/);

const bridgeSource = readFileSync(new URL('../netlify/functions/_shared/piano-preregistration.js', import.meta.url), 'utf8');
assert.doesNotMatch(bridgeSource, /postToOpusOnce|buildOpusPayload|people\/create|fetch\(/);
assert.match(bridgeSource, /not_attempted_vanilla_handoff/);

const schema = readFileSync(new URL('../db/lead-pipeline.sql', import.meta.url), 'utf8');
assert.match(schema, /CREATE TABLE IF NOT EXISTS piano_preregistrations/);
assert.match(schema, /client_submission_id text NOT NULL UNIQUE/);
assert.match(schema, /duplicate_of_lead_id text REFERENCES piano_preregistrations/);
assert.doesNotMatch(schema, /piano_preregistrations[\s\S]*next_attempt_at/);

const migration = readFileSync(
  new URL('../netlify/database/migrations/20260809001500_create_piano_preregistrations.sql', import.meta.url),
  'utf8'
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS piano_preregistrations/);
assert.match(migration, /client_submission_id text NOT NULL UNIQUE/);
assert.match(migration, /piano_preregistrations_dedupe_created_idx/);
assert.doesNotMatch(migration, /next_attempt_at/);

console.log('Piano pre-registration vanilla-handoff checks passed.');
