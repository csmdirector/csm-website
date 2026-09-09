import crypto from 'node:crypto';
import { captureLessonFitSubmission } from './_shared/lead-pipeline.js';
import { createPostgresPreregistrationRepository } from './_shared/intro-bridge.js';
import { deliverRequestInfo, storeGuideRequestInfo } from './_shared/request-info-delivery.js';

const FORM_NAME = 'lesson-fit-request';

function env(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
    const value = Netlify.env.get(name);
    if (value) return value;
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name] || '';
  }
  return '';
}

function isEnabled(name) {
  return ['1', 'true', 'yes', 'on'].includes(String(env(name)).trim().toLowerCase());
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeFields(source) {
  const fields = {};
  Object.entries(source || {}).forEach(([key, value]) => {
    if (!key) return;
    if (Array.isArray(value)) {
      fields[key] = value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ');
      return;
    }
    fields[key] = String(value ?? '').trim();
  });
  return fields;
}

function valueFor(fields, key) {
  return String(fields?.[key] || '').trim();
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
}

function safeClientSubmissionId(value) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{12,96}$/.test(id)) return '';
  return id;
}

async function parseSubmission(req) {
  const contentType = req.headers.get('content-type') || '';
  const rawText = await req.text();
  if (!rawText) return {};

  if (contentType.includes('application/json')) {
    return normalizeFields(JSON.parse(rawText));
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return normalizeFields(Object.fromEntries(new URLSearchParams(rawText).entries()));
  }

  throw new Error('Unsupported content type.');
}

function submissionId(fields) {
  const clientId = safeClientSubmissionId(valueFor(fields, 'client_submission_id'));
  if (clientId) return clientId;

  const submittedAt = new Date(valueFor(fields, 'submitted_at'));
  const submittedDay = Number.isNaN(submittedAt.getTime())
    ? new Date().toISOString().slice(0, 10)
    : submittedAt.toISOString().slice(0, 10);
  const base = [
    FORM_NAME,
    submittedDay,
    valueFor(fields, 'parent_name'),
    valueFor(fields, 'email').toLowerCase(),
    valueFor(fields, 'phone'),
    valueFor(fields, 'lesson_request'),
    valueFor(fields, 'follow_up_notes'),
    valueFor(fields, 'student_context'),
    valueFor(fields, 'routing_outcome')
  ].join('|');

  return `lesson-fit-direct-${sha256(base).slice(0, 32)}`;
}

function validate(fields) {
  const formName = valueFor(fields, 'form-name') || valueFor(fields, 'form_name');
  if (formName && formName !== FORM_NAME) {
    return { ok: false, status: 400, error: 'Unexpected form.' };
  }
  if (valueFor(fields, 'bot-field')) {
    return { ok: true, bot: true };
  }
  if (valueFor(fields, 'lead_pipeline_only') === '1') {
    return { ok: true };
  }

  const missing = ['parent_name', 'email', 'help_reason'].filter((key) => !valueFor(fields, key));
  if (missing.length) {
    return { ok: false, status: 422, error: `Missing required field: ${missing.join(', ')}` };
  }
  if (!isEmailLike(valueFor(fields, 'email'))) {
    return { ok: false, status: 422, error: 'A valid email is required.' };
  }
  return { ok: true };
}

async function settlePipeline(promise) {
  try {
    const result = await promise;
    return { ok: true, result };
  } catch (error) {
    console.error('lesson-fit-submit: pipeline capture failed', error);
    return { ok: false, error: error.message };
  }
}

export function createLessonFitSubmitHandler({
  repositoryFactory = createPostgresPreregistrationRepository,
  capture = captureLessonFitSubmission,
  deliver = deliverRequestInfo
} = {}) {
return async function lessonFitSubmit(req, context) {
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }

  let fields;
  try {
    fields = await parseSubmission(req);
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message }, 400);
  }

  const validation = validate(fields);
  if (validation.bot) return jsonResponse({ ok: true, skipped: true, reason: 'honeypot' });
  if (!validation.ok) return jsonResponse({ ok: false, error: validation.error }, validation.status);

  const id = submissionId(fields);
  const submitted = new Date(valueFor(fields, 'submitted_at'));
  const createdAt = Number.isNaN(submitted.getTime()) ? new Date().toISOString() : submitted.toISOString();
  const pipelineOnly = valueFor(fields, 'lead_pipeline_only') === '1';
  let delivery;
  if (!pipelineOnly) {
    try {
      const repository = repositoryFactory();
      const record = await storeGuideRequestInfo(fields, repository, id, createdAt);
      delivery = await deliver({
        repository, leadId: record.csm_lead_id, clientSubmissionId: record.client_submission_id,
        choice: 'office_help', formName: FORM_NAME
      });
    } catch {
      return jsonResponse({ ok: false, error: 'Request delivery is not confirmed. Please retry or contact CSM directly.' }, 503);
    }
    if (!delivery.office_email_confirmed) return jsonResponse(delivery, delivery.status || 502);
  }
  // Analytics keeps its existing flags. The durable Request Info delivery above
  // owns office email and Opus creation; this copy must never create a second profile.
  const pipelinePromise = settlePipeline(capture({
    formName: FORM_NAME,
    data: {
      ...fields,
      'form-name': FORM_NAME,
      lead_pipeline_only: '1'
    },
    id,
    createdAt,
    provider: 'lesson_fit_direct_endpoint',
    receivedFrom: 'lesson_fit_direct_endpoint'
  }));

  if (context && typeof context.waitUntil === 'function') {
    context.waitUntil(pipelinePromise);
  }

  const pipelineResult = context && typeof context.waitUntil === 'function'
    ? { ok: true, queued: true }
    : await pipelinePromise;

  return jsonResponse({
    ok: true,
    submission_id: id,
    email: pipelineOnly ? { skipped: true, sent: false, reason: 'pipeline_only' } : { sent: true, status: 200 },
    ...(delivery ? { lead_id: delivery.lead_id, office_email_confirmed: true, opus: delivery.opus } : {}),
    pipeline: pipelineResult
  });
};
}

export default createLessonFitSubmitHandler();

export const config = {
  path: '/api/lesson-fit-submit'
};

export const testables = {
  isEnabled,
  parseSubmission,
  safeClientSubmissionId,
  submissionId,
  validate
};
