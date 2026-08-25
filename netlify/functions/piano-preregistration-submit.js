import {
  PIANO_PREREGISTRATION_FORM,
  createPianoPreregistrationBridge,
  createPostgresPreregistrationRepository,
  isEnabled
} from './_shared/piano-preregistration.js';
import { sendFormEmailSubmission } from './form-email.js';

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

async function parseSubmission(req) {
  const contentType = req.headers.get('content-type') || '';
  const rawText = await req.text();
  if (!rawText) return {};
  if (contentType.includes('application/json')) return JSON.parse(rawText);
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(rawText).entries());
  }
  throw new Error('Unsupported content type.');
}

export default async function pianoPreregistrationSubmit(req) {
  if (!isEnabled(env('ENABLE_PIANO_PREREGISTRATION'))) {
    return jsonResponse({ ok: false, disabled: true, error: 'Piano pre-registration is disabled.' }, 404);
  }
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);

  let fields;
  try {
    fields = await parseSubmission(req);
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message }, 400);
  }

  try {
    const bridge = createPianoPreregistrationBridge({
      repository: createPostgresPreregistrationRepository(),
      config: {
        officeEmailEnabled: isEnabled(env('ENABLE_PIANO_PREREGISTRATION_OFFICE_EMAIL'))
      },
      notifyOffice: async (notificationPayload, record) => sendFormEmailSubmission({
        formName: PIANO_PREREGISTRATION_FORM,
        data: notificationPayload,
        id: record.csm_lead_id,
        createdAt: record.submitted_at
      })
    });
    const result = await bridge(fields);
    return jsonResponse(result, result.ok ? 200 : result.status || 500);
  } catch (error) {
    console.error('piano-preregistration-submit: failed before confirmation', error);
    return jsonResponse({
      ok: false,
      stored: false,
      error: 'We could not safely save this pre-registration. Please call or text CSM at (513) 560-9175.'
    }, 503);
  }
}

export const config = {
  path: '/api/piano-preregistration-submit'
};

export const testables = {
  parseSubmission
};
