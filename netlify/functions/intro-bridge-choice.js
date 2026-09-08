import {
  HANDOFF_CHOICES,
  buildOfficeNotification,
  createPostgresPreregistrationRepository
} from './_shared/intro-bridge.js';
import { sendFormEmailSubmission } from './form-email.js';
import { introBridgeEnabled } from './intro-bridge-submit.js';

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

function clean(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

async function parseJson(req) {
  if (!(req.headers.get('content-type') || '').includes('application/json')) {
    throw new Error('JSON is required.');
  }
  return req.json();
}

export function createIntroBridgeChoiceHandler({
  repositoryFactory = createPostgresPreregistrationRepository,
  sendOfficeEmail = sendFormEmailSubmission
} = {}) {
return async function introBridgeChoice(req) {
  const requestUrl = new URL(req.url);
  if (!introBridgeEnabled({
    enabledValue: env('ENABLE_INTRO_BRIDGE'),
    deployContext: env('CONTEXT') || 'unknown',
    hostname: requestUrl.hostname
  })) {
    return jsonResponse({ ok: false, disabled: true, error: 'Intro booking is temporarily unavailable.' }, 404);
  }
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);

  let body;
  try {
    body = await parseJson(req);
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message }, 400);
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
    const repository = repositoryFactory();
    let selected = await repository.recordHandoffChoice(leadId, clientSubmissionId, choice);
    if (!selected.record) return jsonResponse({ ok: false, error: 'Lead not found.' }, 404);
    if (selected.blockedExistingFamily) {
      return jsonResponse({
        ok: false,
        existing_family: true,
        error: 'Existing CSM families are routed to office help.'
      }, 409);
    }

    const officeHelp = choice === HANDOFF_CHOICES.OFFICE_HELP;
    // Older records may say "sent" even though the office-help email route was missing.
    // Only this route's new, explicitly checked acceptance may satisfy a replay.
    let officeEmailConfirmed = selected.record.office_notification_status === 'sent' &&
      selected.record.office_notification_payload?.['form-name'] === 'intro-bridge-office-help';
    if (officeHelp && (!officeEmailConfirmed || selected.changed)) {
      const notificationPayload = {
        ...buildOfficeNotification(selected.record),
        'form-name': 'intro-bridge-office-help',
        subject: 'Request Info'
      };
      let notificationResult;
      try {
        const emailResult = await sendOfficeEmail({
          formName: 'intro-bridge-office-help',
          data: notificationPayload,
          id: selected.record.csm_lead_id,
          createdAt: selected.record.submitted_at
        });
        if (!emailResult?.sent || !Number.isInteger(emailResult.status) ||
            emailResult.status < 200 || emailResult.status >= 300) {
          throw new Error('Office email was not accepted.');
        }
        notificationResult = { status: 'sent' };
        officeEmailConfirmed = true;
      } catch (error) {
        notificationResult = { status: 'failed', error: clean(error?.message || error, 1000) };
        officeEmailConfirmed = false;
      }
      selected = {
        ...selected,
        record: await repository.recordOfficeNotification(
          selected.record.csm_lead_id,
          notificationPayload,
          notificationResult
        )
      };
      if (!officeEmailConfirmed) {
        return jsonResponse({
          ok: false,
          stored: true,
          lead_id: selected.record.csm_lead_id,
          office_email_confirmed: false,
          error: 'Your details are saved, but the office email was not accepted. Please retry or call or text (513) 560-9175.'
        }, 502);
      }
    }

    return jsonResponse({
      ok: true,
      stored: true,
      lead_id: selected.record.csm_lead_id,
      choice: selected.record.handoff_choice || choice,
      booking_url: selected.record.booking_url,
      office_email_confirmed: officeHelp && officeEmailConfirmed,
      office_follow_up_required: Boolean(selected.record.office_follow_up_required),
      replay: selected.replay
    });
  } catch (error) {
    console.error('intro-bridge-choice: failed', error);
    return jsonResponse({
      ok: false,
      error: 'We saved your information, but could not record that choice. Please call or text CSM at (513) 560-9175.'
    }, 503);
  }
};
}

export default createIntroBridgeChoiceHandler();

export const config = { path: '/api/intro-bridge-choice' };
