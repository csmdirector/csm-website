import {
  INTRO_BRIDGE_FORM,
  createIntroBridge,
  createPostgresPreregistrationRepository,
  isEnabled,
  normalizeSubmission,
  validateSubmission
} from './_shared/intro-bridge.js';
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

export function resolveConversionEligibility({ enabledValue = '', deployContext = 'unknown' } = {}) {
  const context = String(deployContext || 'unknown').trim().toLowerCase() || 'unknown';
  const conversionEligible = isEnabled(enabledValue);
  return {
    conversionEligible,
    conversionExclusionReason: conversionEligible ? '' : `production_conversions_disabled:${context}`,
    deployContext: context
  };
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

let conversionGateLogged = false;

export function introBridgeEnabled({ enabledValue = '', deployContext = 'unknown', hostname = '' } = {}) {
  const context = String(deployContext || 'unknown').trim().toLowerCase();
  const host = String(hostname || '').trim().toLowerCase();
  const isolatedNetlifyPreview = /^[a-z0-9-]+--csm-website\.netlify\.app$/.test(host);
  return isEnabled(enabledValue) || isolatedNetlifyPreview || ['deploy-preview', 'branch-deploy', 'dev'].includes(context);
}

export default async function introBridgeSubmit(req) {
  const requestUrl = new URL(req.url);
  if (!introBridgeEnabled({
    enabledValue: env('ENABLE_INTRO_BRIDGE'),
    deployContext: env('CONTEXT') || 'unknown',
    hostname: requestUrl.hostname
  })) {
    return jsonResponse({ ok: false, disabled: true, error: 'Intro booking is temporarily unavailable.' }, 404);
  }
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);

  let fields;
  try {
    fields = await parseSubmission(req);
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message }, 400);
  }

  try {
    const validation = validateSubmission(normalizeSubmission(fields));
    if (validation.bot) return jsonResponse({ ok: true, skipped: true, reason: 'honeypot' });
    if (!validation.ok) return jsonResponse(validation, validation.status || 422);

    const conversionGate = resolveConversionEligibility({
      enabledValue: env('INTRO_BRIDGE_PRODUCTION_CONVERSIONS_ENABLED'),
      deployContext: env('CONTEXT') || 'unknown'
    });
    if (!conversionGateLogged) {
      console.info(
        `intro-bridge-submit: production conversion eligibility ${conversionGate.conversionEligible ? 'enabled' : 'disabled'}; deploy_context=${conversionGate.deployContext}`
      );
      conversionGateLogged = true;
    }
    const bridge = createIntroBridge({
      repository: createPostgresPreregistrationRepository(),
      config: {
        officeEmailEnabled: isEnabled(env('ENABLE_INTRO_BRIDGE_OFFICE_EMAIL')),
        conversionEligible: conversionGate.conversionEligible,
        conversionExclusionReason: conversionGate.conversionExclusionReason
      },
      notifyOffice: async (notificationPayload, record) => sendFormEmailSubmission({
        formName: INTRO_BRIDGE_FORM,
        data: notificationPayload,
        id: record.csm_lead_id,
        createdAt: record.submitted_at
      })
    });
    const result = await bridge(fields);
    return jsonResponse(result, result.ok ? 200 : result.status || 500);
  } catch (error) {
    console.error('intro-bridge-submit: failed before confirmation', error);
    return jsonResponse({
      ok: false,
      stored: false,
      error: 'We could not safely save this booking request. Please call or text CSM at (513) 560-9175.'
    }, 503);
  }
}

export const config = { path: '/api/intro-bridge-submit' };

export const testables = { introBridgeEnabled, parseSubmission, resolveConversionEligibility };
