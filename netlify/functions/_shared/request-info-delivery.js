import crypto from 'node:crypto';
import {
  HANDOFF_CHOICES,
  attributionSummary,
  buildOfficeNotification,
  generateLeadId,
  normalizeEmail,
  normalizePhone,
  parseAttribution
} from './intro-bridge.js';
import { sendFormEmailSubmission } from '../form-email.js';

export const REQUEST_INFO_VERSION = 'request-info-20260909';

function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function inquiryContext(record) {
  return clean(record.student_note, 6000)
    .replace(/Parent still needs to complete the normal Opus booking\/payment flow\.?/g, '')
    .replace(/CSM did not pre-create an Opus parent or student for this ready-to-book lead\.?/g, '')
    .trim();
}
function opusUrl(configuration) {
  const url = new URL(configuration.url);
  if (url.protocol !== 'https:' || url.username || url.password ||
      !(url.hostname === 'opus1.io' || url.hostname.endsWith('.opus1.io'))) {
    throw new Error('The configured Opus destination must be an HTTPS Opus webhook.');
  }
  return url;
}
function splitName(value) {
  const parts = clean(value, 160).split(/\s+/).filter(Boolean);
  return { first: parts.slice(0, -1).join(' ') || parts[0] || '', last: parts.length > 1 ? parts.at(-1) : '' };
}

export function opusConfiguration() {
  const env = typeof Netlify !== 'undefined' ? Netlify.env : null;
  return { url: env?.get('OPUS_INBOUND_WEBHOOK_URL') || '', token: env?.get('OPUS_INBOUND_WEBHOOK_TOKEN') || '' };
}

export function buildRequestInfoOpusPayload(record) {
  const parent = splitName(record.parent_name);
  const student = splitName(record.student_name);
  const adult = /^adult$/i.test(record.student_age || '') || Number(record.student_age) >= 18;
  const samePerson = adult && (!record.student_name || clean(record.student_name).toLowerCase() === clean(record.parent_name).toLowerCase());
  const note = [
    'Request Info: office help requested. No lesson or payment has been booked.',
    `CSM reference: ${record.csm_lead_id}`,
    `Instrument: ${record.instrument}`,
    `Location: ${record.preferred_location}`,
    `Student age: ${record.student_age || 'Not provided'}`,
    `Student name: ${record.student_name || 'Not provided; contact is the parent/account manager'}`,
    record.attribution_summary,
    inquiryContext(record)
  ].filter(Boolean).join('\n');
  const payload = {};
  if (samePerson || student.first) {
    payload.student_first_name = samePerson ? parent.first : student.first;
    payload.student_last_name = samePerson ? parent.last : student.last;
    payload.student_status = 'Prospect (new)';
    payload.student_note = note;
    if (record.student_birthdate) payload.student_birthdate = String(record.student_birthdate).slice(0, 10);
    if (samePerson) {
      payload.student_email = record.parent_email;
      if (record.parent_phone_norm) payload.student_primary_phone = record.parent_phone_norm;
    }
  }
  if (!samePerson) {
    // The guide does not collect a child's name. Create the known parent only;
    // never manufacture a dependent using the parent's name.
    payload.parent1_first_name = parent.first;
    payload.parent1_last_name = parent.last;
    payload.parent1_email = record.parent_email;
    payload.parent1_note = note;
    if (record.parent_phone_norm) payload.parent1_primary_phone = record.parent_phone_norm;
  }
  return payload;
}

export async function sendOpusRequestInfo(payload, configuration) {
  const url = opusUrl(configuration);
  const headers = { 'Content-Type': 'application/json' };
  if (configuration.token) headers.Authorization = `Bearer ${configuration.token}`;
  const response = await fetch(url.href, {
    method: 'POST', headers, body: JSON.stringify(payload),
    redirect: 'error', signal: AbortSignal.timeout(6000)
  });
  const text = (await response.text()).slice(0, 5000);
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  const confirmed = response.ok && body?.status === 'ok' && body?.action === 'create' &&
    body?.resource === 'people' && Array.isArray(body.errors) && body.errors.length === 0;
  return { confirmed, status: response.status, responseBody: text };
}

function opusResult(record) {
  const status = record.existing_family || record.matched_opus_client_id
    ? 'existing_family' : record.opus_post_status;
  return {
    status,
    confirmed: ['office_help_created', 'office_help_linked'].includes(status),
    attempted: Boolean(record.opus_attempted_at)
  };
}

async function ensureOpus(record, repository, configuration, sendOpus) {
  if (record.handoff_choice !== HANDOFF_CHOICES.OFFICE_HELP || record.existing_family || record.matched_opus_client_id) return record;
  if (record.opus_attempted_at || record.opus_post_status?.startsWith('office_help_')) return record;
  try { opusUrl(configuration); } catch {
    return repository.recordOpusRequestInfo(record.csm_lead_id, {
      status: 'blocked_config_request_info', error: 'A valid Opus inbound webhook is not configured.'
    });
  }
  const payload = buildRequestInfoOpusPayload(record);
  const claim = await repository.claimOpusRequestInfo(record, payload);
  if (!claim.claimed) return claim.record || record;
  try {
    const result = await sendOpus(payload, configuration);
    return await repository.recordOpusRequestInfo(record.csm_lead_id, {
      status: result.confirmed ? 'office_help_created' : 'office_help_needs_review',
      httpStatus: result.status,
      responseBody: result.responseBody,
      error: result.confirmed ? null : 'Opus did not confirm record creation. Check the saved response before another attempt.'
    });
  } catch {
    // A timeout may occur after Opus creates the record. Keep the durable attempt
    // and require reconciliation rather than blindly creating another family.
    return repository.recordOpusRequestInfo(record.csm_lead_id, {
      status: 'office_help_needs_review', error: 'Opus delivery is unconfirmed; do not automatically repeat client creation.'
    });
  }
}

function profileSummary(record) {
  if (record.existing_family || record.matched_opus_client_id) return 'Existing CSM account. Use the current account.';
  if (record.handoff_choice !== HANDOFF_CHOICES.OFFICE_HELP) return 'The customer will create or access their account through normal Opus booking.';
  if (record.opus_post_status === 'office_help_created') return 'Opus confirmed the new contact record. No lesson is booked.';
  if (record.opus_post_status === 'office_help_linked') return 'This contact already has a recorded Opus account. No additional account was created.';
  return 'Automatic Opus entry needs attention. The complete inquiry is saved in this email.';
}

export function notificationConfirmed(record) {
  return record.office_notification_status === 'sent' && (
    record.office_notification_payload?._request_info_version === REQUEST_INFO_VERSION ||
    record.office_notification_payload?.['form-name'] === 'intro-bridge-office-help'
  );
}

export function requestInfoNotification(record, formName) {
  const officeHelp = record.handoff_choice === HANDOFF_CHOICES.OFFICE_HELP;
  const allFields = buildOfficeNotification(record);
  const officeFields = Object.fromEntries([
    'client_submission_id', 'csm_lead_id', 'submitted_at', 'existing_family', 'duplicate_of_lead_id',
    'parent_name', 'parent_email', 'parent_phone', 'student_name', 'student_birthdate', 'student_age',
    'instrument', 'preferred_location', 'preferred_time_window', 'attribution_summary'
  ].map(key => [key, allFields[key]]));
  return {
    ...officeFields,
    'form-name': formName,
    subject: 'Request Info',
    _request_info_version: REQUEST_INFO_VERSION,
    parent_next_step: officeHelp ? 'Please contact me to help find a teacher and time.' : 'I am continuing to Opus to choose an intro time.',
    opus_profile_summary: profileSummary(record),
    csm_context: inquiryContext(record)
  };
}

export async function deliverRequestInfo({
  repository, leadId, clientSubmissionId, choice,
  formName = 'intro-bridge-office-help',
  sendOfficeEmail = sendFormEmailSubmission,
  sendOpus = sendOpusRequestInfo,
  configuration = opusConfiguration()
}) {
  const selected = await repository.recordHandoffChoice(leadId, clientSubmissionId, choice);
  if (!selected.record) return { ok: false, status: 404, error: 'Lead not found.' };
  if (selected.blockedExistingFamily) return { ok: false, status: 409, existing_family: true, error: 'Existing CSM families are routed to office help.' };
  let record = selected.record;
  try {
    record = await ensureOpus(record, repository, configuration, sendOpus);
  } catch {
    // The office email remains mandatory even if the integration/database update fails.
    record = { ...record, opus_post_status: 'office_help_needs_review' };
  }
  let confirmed = notificationConfirmed(record);
  if (!confirmed) {
    const claim = await repository.claimOfficeNotification(leadId, requestInfoNotification(record, formName));
    if (claim) {
      record = claim;
      const payload = claim.office_notification_payload;
      try {
        const sent = await sendOfficeEmail({
          formName: payload['form-name'], data: payload, id: leadId, createdAt: record.submitted_at
        });
        if (!sent?.sent || !Number.isInteger(sent.status) || sent.status < 200 || sent.status >= 300) {
          throw new Error('Office email was not accepted.');
        }
        record = await repository.recordOfficeNotification(leadId, payload, { status: 'sent' });
        confirmed = true;
      } catch {
        record = await repository.recordOfficeNotification(leadId, payload, {
          status: 'failed', error: 'Office email was not confirmed. Retry this saved notification.'
        });
      }
    } else {
      record = await repository.getLead(leadId, clientSubmissionId) || record;
      confirmed = notificationConfirmed(record);
    }
  }
  return {
    ok: confirmed, status: confirmed ? 200 : 502,
    stored: true, lead_id: leadId, choice: record.handoff_choice,
    booking_url: record.booking_url, existing_family: Boolean(record.existing_family),
    office_email_confirmed: confirmed,
    office_follow_up_required: Boolean(record.office_follow_up_required),
    opus: opusResult(record), opus_client_create_attempted: Boolean(record.opus_attempted_at),
    replay: Boolean(selected.replay),
    ...(confirmed ? {} : { error: 'Your details are saved, but office delivery is not confirmed. Please retry or call or text (513) 560-9175.' })
  };
}

export async function storeGuideRequestInfo(fields, repository, clientSubmissionId, submittedAt) {
  const parentName = clean(fields.parent_name, 160);
  const email = clean(fields.email, 254).toLowerCase();
  const phone = clean(fields.phone, 40);
  const age = clean(fields.student_age, 40);
  const adult = /^adult$/i.test(age) || Number(age) >= 18;
  const instrument = clean(fields.instrument_interest, 100) || 'Not selected';
  const location = clean(fields.preferred_location, 100) || 'Flexible / not sure';
  const attribution = parseAttribution(fields);
  const context = [fields.lesson_request, fields.help_reason, fields.follow_up_notes, fields.student_context]
    .map(value => clean(value, 2000)).filter(Boolean).join('\n');
  const created = await repository.createLead({
    leadId: generateLeadId(), clientSubmissionId,
    parentName, parentEmail: email, parentEmailNorm: normalizeEmail(email),
    parentPhone: phone, parentPhoneNorm: normalizePhone(phone),
    studentName: clean(fields.student_name, 160) || (adult ? parentName : ''),
    studentBirthdate: '', studentAge: age,
    serviceSlug: 'request-info', instrument,
    preferredLocation: location, preferredLocationSlug: 'request-info',
    preferredTimeWindow: 'Flexible / not sure',
    existingFamily: ['yes', 'true', '1'].includes(clean(fields.existing_family).toLowerCase()),
    bookingUrl: '', attribution, attributionSummary: attributionSummary(attribution),
    studentNote: context,
    dedupeFingerprint: crypto.createHash('sha256').update([normalizeEmail(email), normalizePhone(phone), instrument, location].join('|')).digest('hex'),
    conversionEligible: false, conversionExclusionReason: 'request_info_is_not_a_booking',
    submittedAt
  });
  return created.record;
}
