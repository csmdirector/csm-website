import crypto from 'node:crypto';
import {
  createPianoIntroReconciler,
  createPostgresReconciliationRepository,
  isEnabled
} from './_shared/piano-intro-reconciliation.js';

function env(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
    const value = Netlify.env.get(name);
    if (value) return value;
  }
  if (typeof process !== 'undefined' && process.env) return process.env[name] || '';
  return '';
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function bearer(req) {
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
}

function webhookAuthorized(req) {
  const expected = env('PIANO_INTRO_RECONCILIATION_OPUS_TOKEN');
  if (!expected) return false;
  const url = new URL(req.url);
  const supplied = req.headers.get('x-csm-source-token') || bearer(req) || url.searchParams.get('token') || '';
  return timingSafeEqual(supplied, expected);
}

function adminAuthorized(req) {
  const expected = env('PIANO_INTRO_RECONCILIATION_ADMIN_TOKEN') || env('LEAD_PIPELINE_ADMIN_TOKEN');
  if (!expected) return { ok: false, status: 500, error: 'Reconciliation admin access is not configured.' };
  const supplied = req.headers.get('x-csm-admin-token') || bearer(req);
  return timingSafeEqual(supplied, expected)
    ? { ok: true }
    : { ok: false, status: 401, error: 'Unauthorized.' };
}

async function parsePayload(req) {
  const contentType = req.headers.get('content-type') || '';
  const raw = await req.text();
  if (!raw) return {};
  if (contentType.includes('application/json')) return JSON.parse(raw);
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { raw_body: raw };
  }
}

async function handleAdminRead(req, repository) {
  const auth = adminAuthorized(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
  const url = new URL(req.url);
  const eventId = String(url.searchParams.get('event_id') || '').trim();
  if (eventId) {
    if (!/^\d+$/.test(eventId)) return jsonResponse({ ok: false, error: 'Invalid event ID.' }, 400);
    const event = await repository.getEvent(eventId);
    return event
      ? jsonResponse({ ok: true, event })
      : jsonResponse({ ok: false, error: 'Event not found.' }, 404);
  }
  if (url.searchParams.get('events') === '1') {
    const events = await repository.listEvents(url.searchParams.get('limit'));
    return jsonResponse({ ok: true, events });
  }
  const leadId = String(url.searchParams.get('lead_id') || '').trim();
  if (leadId) {
    const lead = await repository.getLead(leadId);
    return lead
      ? jsonResponse({ ok: true, lead })
      : jsonResponse({ ok: false, error: 'Lead not found.' }, 404);
  }
  const manual = await repository.listManual(url.searchParams.get('limit'));
  return jsonResponse({ ok: true, manual_review: manual });
}

export default async function pianoIntroReconciliation(req) {
  if (!isEnabled(env('ENABLE_PIANO_INTRO_RECONCILIATION'))) {
    return jsonResponse({ ok: false, disabled: true, error: 'Piano Intro reconciliation is disabled.' }, 404);
  }

  let repository;
  try {
    repository = createPostgresReconciliationRepository();
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Reconciliation storage is unavailable.' }, 503);
  }

  if (req.method === 'GET') {
    try {
      return await handleAdminRead(req, repository);
    } catch (error) {
      console.error('piano-intro-reconciliation: admin read failed', error);
      return jsonResponse({ ok: false, error: 'Could not read reconciliation status.' }, 500);
    }
  }
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  if (!webhookAuthorized(req)) return jsonResponse({ ok: false, error: 'Unauthorized.' }, 401);

  try {
    const payload = await parsePayload(req);
    const url = new URL(req.url);
    const configuredTrigger = String(url.searchParams.get('trigger') || '').trim();
    const reconciler = createPianoIntroReconciler({ repository });
    const result = await reconciler(payload, {
      'x-opus-event': req.headers.get('x-opus-event') || '',
      'x-opus-trigger': configuredTrigger || req.headers.get('x-opus-trigger') || ''
    });
    return jsonResponse({
      ok: true,
      event_id: result.event_id,
      duplicate: Boolean(result.duplicate),
      reconciliation_status: result.reconciliation_status,
      reason: result.reason || undefined
    });
  } catch (error) {
    console.error('piano-intro-reconciliation: webhook processing failed', error);
    return jsonResponse({ ok: false, error: 'The Opus event was stored but could not be reconciled.' }, 500);
  }
}

export const config = {
  path: '/api/piano-intro-reconciliation'
};

export const testables = {
  adminAuthorized,
  parsePayload,
  timingSafeEqual,
  webhookAuthorized
};
