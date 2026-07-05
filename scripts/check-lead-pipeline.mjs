import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  captureNetlifyLessonFitSubmission,
  handleLeadEventsRequest
} from '../netlify/functions/_shared/lead-pipeline.js';
import { testables } from '../netlify/functions/_shared/lead-pipeline.js';
import formEmailHandler, { testables as formEmailTestables } from '../netlify/functions/form-email.js';

const {
  buildEventEnvelope,
  canonicalizeStoredEvent,
  authorizeSource,
  isLeadPipelineEnabled,
  normalizeEmail,
  normalizeEventType,
  normalizePhone,
  parseRequestBody,
  parseTrackingSummary
} = testables;
const {
  ROUTES,
  buildText,
  normalizeFields: normalizeEmailFields,
  shouldSkipOfficeEmail
} = formEmailTestables;

delete process.env.ENABLE_LEAD_PIPELINE;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.NETLIFY_DATABASE_URL;
delete process.env.LEAD_EVENTS_LESSON_FIT_TOKEN;
delete process.env.LEAD_EVENTS_OPUS_TOKEN;

assert.equal(isLeadPipelineEnabled(), false);

assert.equal(normalizeEmail(' First.Last+tag@Gmail.com '), 'firstlast@gmail.com');
assert.equal(normalizePhone('(513) 560-9175'), '+15135609175');
assert.equal(normalizeEventType('client_create_trigger', 'opus'), 'client_create');
assert.equal(normalizeEventType('subscription update', 'opus'), 'subscription_update');

process.env.LEAD_EVENTS_LESSON_FIT_TOKEN = 'lesson-fit-secret';
process.env.LEAD_EVENTS_OPUS_TOKEN = 'opus-secret';
const lessonQueryAuth = authorizeSource(new Request('https://example.com/api/lead-events?source=lesson_fit&token=lesson-fit-secret'));
assert.deepEqual(lessonQueryAuth, { ok: true, source: 'lesson_fit' });
assert.equal(authorizeSource(new Request('https://example.com/api/lead-events?source=opus&token=opus-secret')).ok, false);
assert.equal(authorizeSource(new Request('https://example.com/api/lead-events?source=lesson_fit&token=opus-secret')).ok, false);
const opusHeaderAuth = authorizeSource(new Request('https://example.com/api/lead-events', {
  headers: {
    'X-CSM-Source': 'opus',
    'X-CSM-Source-Token': 'opus-secret'
  }
}));
assert.deepEqual(opusHeaderAuth, { ok: true, source: 'opus' });
delete process.env.LEAD_EVENTS_LESSON_FIT_TOKEN;
delete process.env.LEAD_EVENTS_OPUS_TOKEN;

const tracking = parseTrackingSummary([
  'Source: google / cpc',
  'Campaign: voice',
  'Search term: voice lessons cincinnati',
  'Click ID: test-click',
  'Landing page: /lesson-fit/?utm_source=google'
].join('\n'));
assert.deepEqual(tracking, {
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'voice',
  utm_term: 'voice lessons cincinnati',
  click_id: 'test-click',
  landing_path: '/lesson-fit/?utm_source=google'
});

const lessonPayload = {
  provider: 'netlify_forms',
  form_name: 'lesson-fit-request',
  submission_id: 'submission-1',
  created_at: '2026-07-04T15:01:00-04:00',
  data: {
    'form-name': 'lesson-fit-request',
    parent_name: 'Jane Student',
    email: 'Jane.Student+lead@gmail.com',
    phone: '513-555-0100',
    instrument_interest: 'Voice',
    student_age: 'Adult',
    preferred_location: 'CSM Montgomery',
    next_step_preference: 'Need help choosing',
    help_reason: 'Finding a good teacher fit',
    student_context: 'Wants to sing pop songs',
    utm_source: 'google',
    utm_medium: 'cpc',
    submitted_at: '2026-07-04T15:01:00-04:00'
  }
};
const firstEnvelope = buildEventEnvelope({
  source: 'lesson_fit',
  eventType: 'form_submitted',
  externalId: 'submission-1',
  payload: lessonPayload,
  receivedFrom: 'test'
});
const secondEnvelope = buildEventEnvelope({
  source: 'lesson_fit',
  eventType: 'form_submitted',
  externalId: 'submission-1',
  payload: lessonPayload,
  receivedFrom: 'test'
});
assert.equal(firstEnvelope.dedupeKey, secondEnvelope.dedupeKey);

const schema = readFileSync(new URL('../db/lead-pipeline.sql', import.meta.url), 'utf8');
assert.match(schema, /dedupe_key text NOT NULL UNIQUE/);
assert.match(schema, /opus_client_id text UNIQUE/);
assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS people_email_norm_unique/);

const canonicalLesson = canonicalizeStoredEvent({
  source: 'lesson_fit',
  event_type: 'form_submitted',
  payload: firstEnvelope.payload,
  received_at: '2026-07-04T19:01:00Z'
});
assert.equal(canonicalLesson.emailNorm, 'janestudent@gmail.com');
assert.equal(canonicalLesson.forwardToOpus, true);
assert.equal(canonicalLesson.opusInboundPayload.student_tags[0], 'lesson-fit');

const opusCanonical = canonicalizeStoredEvent({
  source: 'opus',
  event_type: 'subscription_create',
  payload: {
    body: {
      subscription: {
        id: 456,
        client_id: 123,
        status: 'active',
        created_at: '2026-07-05T12:00:00Z'
      }
    }
  },
  received_at: '2026-07-05T12:00:01Z'
});
assert.equal(opusCanonical.opusClientId, '123');
assert.equal(opusCanonical.subscriptionCreatedAt, '2026-07-05T12:00:00.000Z');

const disabledCapture = await captureNetlifyLessonFitSubmission({
  payload: {
    form_name: 'lesson-fit-request',
    id: 'disabled-test',
    data: lessonPayload.data
  }
});
assert.deepEqual(
  { ok: disabledCapture.ok, skipped: disabledCapture.skipped, disabled: disabledCapture.disabled },
  { ok: true, skipped: true, disabled: true }
);

const disabledHttp = await handleLeadEventsRequest(new Request('https://example.com/api/lead-events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{"bad json"'
}));
assert.equal(disabledHttp.status, 200);
assert.equal((await disabledHttp.json()).disabled, true);

const malformed = await parseRequestBody(new Request('https://example.com/api/lead-events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{"bad json"'
}));
assert.equal(malformed.parsed.raw_body, '{"bad json"');
assert.match(malformed.parsed.parse_error, /JSON/);

const emailFields = normalizeEmailFields({
  'form-name': 'lesson-fit-request',
  subject: 'New Lesson Fit Help Request',
  email: 'parent@example.com',
  contact_summary: 'Name: Jane Student\nPhone: 513-555-0100',
  lesson_request: 'Instrument: Voice',
  follow_up_notes: 'Help with: Finding a good teacher fit',
  tracking_summary: 'Source: google / cpc',
  routing_outcome: 'staff-help',
  recommended_url: 'https://example.com',
  lead_pipeline_only: ''
});
const emailText = buildText(ROUTES['lesson-fit-request'], 'lesson-fit-request', emailFields, {
  id: 'email-test',
  createdAt: '2026-07-04T15:01:00Z'
});
assert.match(emailText, /Lesson Fit Request/);
assert.doesNotMatch(emailText, /Routing Outcome/i);
assert.doesNotMatch(emailText, /Lead Pipeline Only/i);
assert.equal(shouldSkipOfficeEmail(emailFields), false);
assert.equal(shouldSkipOfficeEmail({ lead_pipeline_only: '1' }), true);

const originalFetch = globalThis.fetch;
const sentEmails = [];
globalThis.fetch = async (url, options = {}) => {
  sentEmails.push({ url: String(url), body: JSON.parse(options.body || '{}') });
  return { ok: true, status: 200, text: async () => '{"id":"test-email"}' };
};
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.ENABLE_LEAD_PIPELINE = 'true';
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.NETLIFY_DATABASE_URL;

await formEmailHandler.formSubmitted({
  payload: {
    form_name: 'lesson-fit-request',
    id: 'email-fail-open-test',
    created_at: '2026-07-04T15:01:00Z',
    data: {
      ...emailFields,
      parent_name: 'Jane Student'
    }
  }
});
assert.equal(sentEmails.length, 1);
assert.equal(sentEmails[0].body.to[0], 'info@cincinnatischoolofmusic.com');

await formEmailHandler.formSubmitted({
  payload: {
    form_name: 'lesson-fit-request',
    id: 'pipeline-only-email-test',
    created_at: '2026-07-04T15:02:00Z',
    data: {
      ...emailFields,
      lead_pipeline_only: '1'
    }
  }
});
assert.equal(sentEmails.length, 1);

globalThis.fetch = originalFetch;
delete process.env.RESEND_API_KEY;
delete process.env.ENABLE_LEAD_PIPELINE;

const lessonFitPage = readFileSync(new URL('../src/pages/lesson-fit/index.astro', import.meta.url), 'utf8');
assert.match(lessonFitPage, /noindex=\{true\}/);
assert.match(lessonFitPage, /ENABLE_LEAD_PIPELINE_CAPTURE/);

process.env.ENABLE_LEAD_PIPELINE = 'true';
assert.equal(isLeadPipelineEnabled(), true);
delete process.env.ENABLE_LEAD_PIPELINE;

globalThis.Netlify = { env: { get: () => '' } };
process.env.ENABLE_LEAD_PIPELINE = 'true';
assert.equal(isLeadPipelineEnabled(), true);
delete process.env.ENABLE_LEAD_PIPELINE;
delete globalThis.Netlify;

console.log('lead pipeline checks passed');
