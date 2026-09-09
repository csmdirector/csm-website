import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createPostgresPreregistrationRepository } from '../netlify/functions/_shared/intro-bridge.js';
import { storeGuideRequestInfo, deliverRequestInfo } from '../netlify/functions/_shared/request-info-delivery.js';

// This gate runs only against the disposable local PostgreSQL service in CI.
// It never reads production credentials or contacts email/Opus providers.
const url = new URL(process.env.CSM_INTAKE_TEST_DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.equal(url.pathname, '/csm_intake_test');
const database = new pg.Pool({ connectionString: url.href, max: 10 });
const repository = createPostgresPreregistrationRepository({ database });
let opusCount = 0;
const emails = [];
const configuration = { url: 'https://test.opus1.io/local-only' };
const sendOpus = async () => { opusCount++; return { confirmed: true, status: 200, responseBody: '{"status":"ok"}' }; };
const sendOfficeEmail = async payload => { emails.push(structuredClone(payload)); return { sent: true, status: 200 }; };
const fields = { parent_name: 'Local Test Adult', email: 'local@example.com', phone: '5135550100', student_age: 'Adult',
  instrument_interest: 'Voice', preferred_location: 'CSM Montgomery', help_reason: 'Local-only database verification' };
async function save(id, contact = fields) { return storeGuideRequestInfo(contact, repository, id, '2026-09-09T00:00:00Z'); }
function deliver(record, overrides = {}) {
  return deliverRequestInfo({ repository, leadId: record.csm_lead_id, clientSubmissionId: record.client_submission_id,
    choice: 'office_help', configuration, sendOpus, sendOfficeEmail, ...overrides });
}
try {
  await database.query(readFileSync(new URL('../db/lead-pipeline.sql', import.meta.url), 'utf8'));
  await database.query(readFileSync(new URL('../netlify/database/migrations/20260831193000_add-intro-handoff-choice/migration.sql', import.meta.url), 'utf8'));
  const sameSubmission = await Promise.all(Array.from({ length: 6 }, () => save('local-concurrent-submission')));
  assert.equal(new Set(sameSubmission.map(row => row.csm_lead_id)).size, 1, 'Concurrent saves must return one durable inquiry.');
  await Promise.all(sameSubmission.map(row => deliver(row)));
  const confirmed = await deliver(sameSubmission[0]);
  assert.equal(confirmed.office_email_confirmed, true);
  assert.equal(emails.length, 1, 'Concurrent delivery must send one notification.');
  assert.equal(opusCount, 1, 'Concurrent delivery must create one account.');

  const differentInquiries = await Promise.all(['piano', 'drums'].map(instrument_interest => save(`local-${instrument_interest}`, { ...fields, instrument_interest })));
  const related = await Promise.all(differentInquiries.map(row => deliver(row)));
  assert.equal(opusCount, 1, 'Different instruments with the same contact must reuse the known account.');
  assert.ok(related.every(result => result.opus.status === 'office_help_linked'));

  const uncertain = await save('local-uncertain', { ...fields, email: 'uncertain@example.com' });
  let uncertainAttempts = 0;
  const unknown = () => deliver(uncertain, { sendOpus: async () => { uncertainAttempts++; throw new Error('Timeout'); } });
  await unknown();
  await unknown();
  assert.equal(uncertainAttempts, 1);
  const relatedUnknown = await save('local-uncertain-again', { ...fields, email: 'uncertain@example.com', instrument_interest: 'Piano' });
  assert.equal((await deliver(relatedUnknown)).opus.status, 'office_help_needs_review');
  assert.equal(opusCount, 1, 'A second form cannot repeat an uncertain creation.');

  const retry = await save('local-email-retry', { ...fields, email: 'retry@example.com' });
  let firstPayload;
  const failed = await deliver(retry, { sendOfficeEmail: async payload => { firstPayload = structuredClone(payload); throw new Error('Email timeout'); } });
  assert.equal(failed.office_email_confirmed, false);
  const success = await deliver(retry, { sendOfficeEmail: async payload => { assert.deepEqual(payload, firstPayload); return { sent: true, status: 200 }; } });
  assert.equal(success.office_email_confirmed, true);
  console.log('PostgreSQL checks passed: concurrent saves, one notification, cross-form account deduplication, uncertain writes, and stable email retry. No live providers contacted.');
} finally {
  await database.end();
}
