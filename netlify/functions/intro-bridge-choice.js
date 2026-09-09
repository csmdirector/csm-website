import { HANDOFF_CHOICES, createPostgresPreregistrationRepository } from './_shared/intro-bridge.js';
import { deliverRequestInfo } from './_shared/request-info-delivery.js';
import { introBridgeEnabled } from './intro-bridge-submit.js';

function env(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env?.get) return Netlify.env.get(name) || '';
  return typeof process !== 'undefined' ? process.env[name] || '' : '';
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
function clean(value, max) { return String(value || '').trim().slice(0, max); }

export function createIntroBridgeChoiceHandler({
  repositoryFactory = createPostgresPreregistrationRepository,
  sendOfficeEmail, sendOpus, configuration, deliver = deliverRequestInfo
} = {}) {
  return async function introBridgeChoice(req) {
    const requestUrl = new URL(req.url);
    if (!introBridgeEnabled({ enabledValue: env('ENABLE_INTRO_BRIDGE'), deployContext: env('CONTEXT') || 'unknown', hostname: requestUrl.hostname })) {
      return jsonResponse({ ok: false, disabled: true, error: 'Intro booking is temporarily unavailable.' }, 404);
    }
    if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
    let body;
    try {
      if (!(req.headers.get('content-type') || '').includes('application/json')) throw new Error('JSON is required.');
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: 'A valid JSON request is required.' }, 400);
    }
    const leadId = clean(body?.lead_id, 64);
    const clientSubmissionId = clean(body?.client_submission_id, 96);
    const choice = clean(body?.choice, 40);
    if (!/^CSM-PRE-\d{8}-[A-Z0-9]{8}$/.test(leadId) || !/^[a-zA-Z0-9_-]{12,96}$/.test(clientSubmissionId)) {
      return jsonResponse({ ok: false, error: 'Invalid lead reference.' }, 422);
    }
    if (!Object.values(HANDOFF_CHOICES).includes(choice)) {
      return jsonResponse({ ok: false, error: 'Choose online booking or office help.' }, 422);
    }
    try {
      const result = await deliver({
        repository: repositoryFactory(), leadId, clientSubmissionId, choice,
        sendOfficeEmail, sendOpus, configuration
      });
      return jsonResponse(result, result.status || (result.ok ? 200 : 503));
    } catch {
      return jsonResponse({
        ok: false, stored: true, lead_id: leadId, office_email_confirmed: false,
        error: 'Your details are saved, but delivery is not confirmed. Please retry or call or text (513) 560-9175.'
      }, 503);
    }
  };
}

export default createIntroBridgeChoiceHandler();
export const config = { path: '/api/intro-bridge-choice' };
