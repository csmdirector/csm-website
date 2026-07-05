import crypto from 'node:crypto';
import { captureLessonFitSubmission } from './_shared/lead-pipeline.js';
import { sendFormEmailSubmission } from './form-email.js';

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

export default async function lessonFitSubmit(req, context) {
  if (!isEnabled('ENABLE_LESSON_FIT_DIRECT_SUBMIT')) {
    return jsonResponse({ ok: false, disabled: true, error: 'Lesson Fit direct submit is disabled.' }, 404);
  }

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
  const createdAt = valueFor(fields, 'submitted_at') || new Date().toISOString();
  const pipelinePromise = settlePipeline(captureLessonFitSubmission({
    formName: FORM_NAME,
    data: {
      ...fields,
      'form-name': FORM_NAME
    },
    id,
    createdAt,
    provider: 'lesson_fit_direct_endpoint',
    receivedFrom: 'lesson_fit_direct_endpoint'
  }));

  if (context && typeof context.waitUntil === 'function') {
    context.waitUntil(pipelinePromise);
  }

  let emailResult;
  try {
    emailResult = await sendFormEmailSubmission({
      formName: FORM_NAME,
      data: fields,
      id,
      createdAt
    });
  } catch (error) {
    console.error('lesson-fit-submit: office email failed', error);
    if (!context || typeof context.waitUntil !== 'function') await pipelinePromise;
    return jsonResponse({ ok: false, error: 'Office email failed. Please contact CSM directly.' }, 502);
  }

  const pipelineResult = context && typeof context.waitUntil === 'function'
    ? { ok: true, queued: true }
    : await pipelinePromise;

  return jsonResponse({
    ok: true,
    submission_id: id,
    email: emailResult,
    pipeline: pipelineResult
  });
}

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
