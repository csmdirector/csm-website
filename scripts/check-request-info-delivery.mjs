import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createIntroBridgeChoiceHandler } from '../netlify/functions/intro-bridge-choice.js';
import { createIntroBridgeSubmitHandler } from '../netlify/functions/intro-bridge-submit.js';
import { createLessonFitSubmitHandler } from '../netlify/functions/lesson-fit-submit.js';
import { buildRequestInfoOpusPayload, deliverRequestInfo, sendOpusRequestInfo } from '../netlify/functions/_shared/request-info-delivery.js';
import { requestInfoRepository } from './fixtures/request-info-repository.mjs';

// Local-only checks: all email-provider requests are intercepted below.
process.env.ENABLE_INTRO_BRIDGE = 'true';
process.env.ENABLE_INTRO_BRIDGE_OFFICE_EMAIL = 'false';
process.env.RESEND_API_KEY = 'local-test-never-sent';
const originalFetch = globalThis.fetch;
const providerCalls = [];
let providerStatus = 200;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.resend.com/emails');
  providerCalls.push({ body: JSON.parse(options.body), headers: options.headers });
  return new Response(JSON.stringify({ id: 'local-only-email', message: 'simulated response' }), { status: providerStatus });
};

const lead = {
  csm_lead_id: 'CSM-PRE-20260908-A1B2C3D4',
  client_submission_id: 'local-office-help-0001',
  submitted_at: '2026-09-08T14:00:00.000Z',
  parent_name: 'Test Parent', parent_email: 'local-test@example.com', parent_phone: '5135550100',
  parent_email_norm: 'local-test@example.com', parent_phone_norm: '+15135550100',
  student_name: 'Test Student', student_age: '12', service_slug: 'voice', instrument: 'Voice',
  preferred_location: 'CSM Montgomery', preferred_time_window: 'Flexible / not sure',
  existing_family: false, handoff_choice: '', office_follow_up_required: false,
  office_notification_status: 'pending', office_notification_payload: {},
  booking_url: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-voice-intro',
  attribution_summary: 'google / cpc; gclid=LOCAL-TEST; campaign=voice',
  student_note: 'Local verification only', opus_post_status: 'not_attempted'
};

function repository(initial = {}) {
  return requestInfoRepository({ ...lead, ...initial });
}

function request(choice = 'office_help') {
  return new Request('https://cincinnatischoolofmusic.com/api/intro-bridge-choice', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lead_id: lead.csm_lead_id, client_submission_id: lead.client_submission_id, choice })
  });
}

try {
  const stored = repository();
  const handler = createIntroBridgeChoiceHandler({ repositoryFactory: () => stored });
  let response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).office_email_confirmed, true);
  assert.equal(providerCalls.length, 1, 'Explicit office help must send even when the optional initial-notification flag is false.');
  assert.equal(providerCalls[0].body.subject, 'Request Info');
  assert.deepEqual(providerCalls[0].body.to, ['info@cincinnatischoolofmusic.com']);
  assert.equal(providerCalls[0].body.reply_to, lead.parent_email);
  assert.match(providerCalls[0].body.html, /Form: Request Info/);
  assert.doesNotMatch(providerCalls[0].body.text, /Form: intro-bridge|ready_buyer|Opus post status/);
  for (const value of [lead.parent_name, lead.parent_phone, lead.student_name, lead.preferred_location, lead.attribution_summary]) {
    assert.ok(providerCalls[0].body.text.includes(value), `Office email lost ${value}`);
  }
  response = await handler(request());
  assert.equal((await response.json()).office_email_confirmed, true);
  assert.equal(providerCalls.length, 1, 'A verified replay must not send another email.');

  const retryStore = repository();
  const retryHandler = createIntroBridgeChoiceHandler({ repositoryFactory: () => retryStore });
  providerStatus = 503;
  response = await retryHandler(request());
  assert.equal(response.status, 502);
  const failed = await response.json();
  assert.equal(failed.ok, false);
  assert.equal(failed.stored, true);
  assert.equal(failed.office_email_confirmed, false);
  assert.equal(retryStore.row.office_notification_status, 'failed');
  const failedPayload = providerCalls.at(-1);
  providerStatus = 200;
  response = await retryHandler(request());
  assert.equal(response.status, 200, 'An already-saved choice must retry an unconfirmed email.');
  assert.equal((await response.json()).office_email_confirmed, true);
  assert.deepEqual(providerCalls.at(-1), failedPayload, 'Retries should keep the same email payload and idempotency key.');

  for (const outcome of [{ ok: true, skipped: true, reason: 'no_route' }, { ok: true, sent: true, deduped: true, status: 409 }]) {
    const rejectedStore = repository();
    const rejected = createIntroBridgeChoiceHandler({ repositoryFactory: () => rejectedStore, sendOfficeEmail: async () => outcome });
    response = await rejected(request());
    assert.equal(response.status, 502);
    assert.equal(rejectedStore.row.office_notification_status, 'failed');
  }

  const oldStore = repository({ handoff_choice: 'office_help', office_notification_status: 'sent', office_notification_payload: { 'form-name': 'intro-bridge' } });
  const oldHandler = createIntroBridgeChoiceHandler({ repositoryFactory: () => oldStore });
  const beforeOld = providerCalls.length;
  response = await oldHandler(request());
  assert.equal(response.status, 200);
  assert.equal(providerCalls.length, beforeOld + 1, 'Old false-success records cannot satisfy office-help delivery.');

  const existingStore = repository({ existing_family: true });
  const existingHandler = createIntroBridgeChoiceHandler({ repositoryFactory: () => existingStore });
  response = await existingHandler(request('online_booking'));
  assert.equal(response.status, 409, 'Existing-family routing must be preserved.');
  response = await existingHandler(request());
  assert.equal(response.status, 200);

  const page = readFileSync(new URL('../src/components/IntroBooking.astro', import.meta.url), 'utf8');
  const start = page.indexOf('async function finish(choice){');
  const end = page.indexOf('      const id = ', start);
  assert.ok(start >= 0 && end > start);
  for (const confirmed of [undefined, false, true]) {
    const elements = new Map();
    const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, { hidden: true, textContent: '', focus() {} }); return elements.get(id); } };
    const finish = new Function('document', 'recordChoice', 'savedExisting', 'saved', `${page.slice(start, end)}; return finish;`)(document, async () => ({ ok: true, office_email_confirmed: confirmed }), false, {});
    await finish('office_help');
    assert.equal(document.getElementById('retryOffice').hidden, confirmed === true);
    assert.equal(document.getElementById('successHeading').textContent === 'We’ll help you from here.', confirmed === true);
  }
  const configuration = { url: 'https://test.opus1.io/local-only' };
  const opusCalls = [];
  const sendOpus = async payload => {
    opusCalls.push(payload);
    return { confirmed: true, status: 200, responseBody: '{"status":"ok"}' };
  };
  const deliver = options => deliverRequestInfo({ ...options, configuration, sendOpus });
  for (const choice of ['office_help', 'online_booking']) {
    const compactStore = requestInfoRepository();
    const compact = createIntroBridgeSubmitHandler({ repositoryFactory: () => compactStore, deliver });
    const fields = {
      client_submission_id: `compact-local-${choice}`, parent_name: 'Test Adult', parent_email: 'adult@example.com',
      parent_phone: '5135550100', student_name: 'Test Adult', student_age: '30', service_slug: 'voice',
      preferred_location: 'montgomery', preferred_time_window: 'Flexible / not sure', existing_family: 'no',
      booking_action: choice, attribution_json: JSON.stringify({ utm_source: 'google', utm_medium: 'cpc', gclid: 'LOCAL-CLICK' })
    };
    const beforeEmail = providerCalls.length;
    const beforeOpus = opusCalls.length;
    const submit = () => compact(new Request('https://example.com/api/intro-bridge-submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields)
    }));
    const saved = await (await submit()).json();
    assert.equal(saved.stored, true);
    assert.equal(saved.choice, choice);
    assert.equal(saved.office_email_confirmed, true);
    assert.equal(providerCalls.length, beforeEmail + 1, 'Save plus choice must deliver exactly one notification.');
    assert.match(providerCalls.at(-1).body.text, /LOCAL-CLICK/);
    assert.equal(opusCalls.length, beforeOpus + (choice === 'office_help' ? 1 : 0));
    assert.equal((await (await submit()).json()).office_email_confirmed, true);
    assert.equal(providerCalls.length, beforeEmail + 1, 'HTTP retry must reuse confirmed delivery.');
    assert.equal(opusCalls.length, beforeOpus + (choice === 'office_help' ? 1 : 0));
  }
  assert.equal(opusCalls[0].student_primary_phone, '+15135550100');
  assert.equal(opusCalls[0].parent1_email, undefined, 'Adult contact must not also become a parent record.');
  assert.doesNotMatch(opusCalls[0].student_note, /did not pre-create|still needs to complete/);

  const guideStore = requestInfoRepository();
  const analytics = [];
  const guide = createLessonFitSubmitHandler({ repositoryFactory: () => guideStore, deliver, capture: async payload => { analytics.push(payload); return {}; } });
  const guideFields = { client_submission_id: 'guide-local-child', parent_name: 'Known Parent', email: 'parent@example.com', phone: '5135550100',
    student_age: '8', instrument_interest: 'Drums', preferred_location: 'CSM Anderson', help_reason: 'Please help choose a teacher', utm_source: 'google', gclid: 'GUIDE-CLICK' };
  response = await guide(new Request('https://example.com/api/lesson-fit-submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(guideFields) }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).opus.confirmed, true);
  assert.equal(opusCalls.at(-1).parent1_first_name, 'Known');
  assert.equal(opusCalls.at(-1).parent1_primary_phone, '+15135550100');
  assert.equal(opusCalls.at(-1).student_first_name, undefined, 'Do not invent an unnamed child from the parent name.');
  assert.match(opusCalls.at(-1).parent1_note, /GUIDE-CLICK/);
  assert.equal(analytics[0].data.lead_pipeline_only, '1', 'The analytics copy cannot create another Opus profile.');

  const timeoutStore = repository();
  let timedAttempts = 0;
  const timeoutHandler = createIntroBridgeChoiceHandler({ repositoryFactory: () => timeoutStore, configuration,
    sendOpus: async () => { timedAttempts++; throw new Error('Provider timeout after possible creation'); } });
  const timed = await (await timeoutHandler(request())).json();
  assert.equal(timed.office_email_confirmed, true, 'Opus failure must not strand the office inquiry.');
  assert.equal(timed.opus.status, 'office_help_needs_review');
  await timeoutHandler(request());
  assert.equal(timedAttempts, 1, 'An uncertain Opus write must not be retried automatically.');

  const blockedStore = repository();
  await createIntroBridgeChoiceHandler({ repositoryFactory: () => blockedStore, configuration: { url: 'https://wrong.example.com' }, sendOpus })(request());
  assert.equal(blockedStore.row.opus_post_status, 'blocked_config_request_info');
  assert.equal(blockedStore.row.opus_attempted_at, undefined, 'Bad configuration must not consume the creation attempt.');
  await createIntroBridgeChoiceHandler({ repositoryFactory: () => blockedStore, configuration, sendOpus })(request());
  assert.equal(blockedStore.row.opus_post_status, 'office_help_created');

  const concurrentStore = repository();
  const beforeConcurrent = providerCalls.length;
  let releaseOpus;
  const waitingOpus = new Promise(resolve => { releaseOpus = resolve; });
  const concurrent = createIntroBridgeChoiceHandler({ repositoryFactory: () => concurrentStore, configuration,
    sendOpus: async () => { await waitingOpus; return { confirmed: true, status: 200 }; } });
  const first = concurrent(request());
  await new Promise(resolve => setImmediate(resolve));
  await concurrent(request());
  releaseOpus();
  await first;
  assert.equal(providerCalls.length, beforeConcurrent + 1, 'Overlapping retries must not send two office emails.');

  for (const body of [ { status: 'ok', action: 'create', resource: 'people', errors: [] },
    { status: 'ok', action: 'create', resource: 'people', errors: ['Invalid contact'] }, {}, 'not json' ]) {
    globalThis.fetch = async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
    const result = await sendOpusRequestInfo(buildRequestInfoOpusPayload(lead), configuration);
    assert.equal(result.confirmed, Boolean(body.status === 'ok' && body.errors.length === 0));
  }
  console.log('Request Info checks passed: one notification, attribution, compact and guide intake, existing-family routing, self-booking isolation, safe Opus retries, corrected phone fields, provider error handling, and browser confirmation. No live emails or Opus writes.');
} finally {
  globalThis.fetch = originalFetch;
}
