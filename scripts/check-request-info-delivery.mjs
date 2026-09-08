import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createIntroBridgeChoiceHandler } from '../netlify/functions/intro-bridge-choice.js';

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
  student_name: 'Test Student', student_age: '12', service_slug: 'voice', instrument: 'Voice',
  preferred_location: 'CSM Montgomery', preferred_time_window: 'Flexible / not sure',
  existing_family: false, handoff_choice: '', office_follow_up_required: false,
  office_notification_status: 'pending', office_notification_payload: {},
  booking_url: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-voice-intro',
  attribution_summary: 'google / cpc; gclid=LOCAL-TEST; campaign=voice',
  student_note: 'Local verification only', opus_post_status: 'not_attempted'
};

function repository(initial = {}) {
  let row = { ...lead, ...initial };
  return {
    get row() { return row; },
    async recordHandoffChoice(id, clientId, choice) {
      assert.equal(id, row.csm_lead_id);
      assert.equal(clientId, row.client_submission_id);
      if (row.existing_family && choice === 'online_booking') {
        return { record: { ...row }, changed: false, blockedExistingFamily: true };
      }
      const changed = row.handoff_choice !== choice;
      row = { ...row, handoff_choice: choice, office_follow_up_required: choice === 'office_help' || row.office_follow_up_required };
      return { record: { ...row }, changed, replay: !changed };
    },
    async recordOfficeNotification(id, payload, result) {
      assert.equal(id, row.csm_lead_id);
      row = { ...row, office_notification_payload: payload, office_notification_status: result.status };
      return { ...row };
    }
  };
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
    const finish = new Function('document', 'recordChoice', 'savedExisting', `${page.slice(start, end)}; return finish;`)(document, async () => ({ ok: true, office_email_confirmed: confirmed }), false);
    await finish('office_help');
    assert.equal(document.getElementById('retryOffice').hidden, confirmed === true);
    assert.equal(document.getElementById('successHeading').textContent === 'We’ll help you from here.', confirmed === true);
  }
  console.log('Request Info checks passed: real route, provider acceptance, retry after failure, old false-success records, attribution, and browser confirmation. No live emails sent.');
} finally {
  globalThis.fetch = originalFetch;
}
