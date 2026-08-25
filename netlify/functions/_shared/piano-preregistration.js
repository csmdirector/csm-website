import crypto from 'node:crypto';
import { getConnectionString } from '@netlify/database';
import pg from 'pg';
import { pianoBookingLocation } from '../../../shared/piano-booking-links.js';

const { Pool } = pg;

export const PIANO_PREREGISTRATION_FORM = 'piano-preregistration';
export const DUPLICATE_WINDOW_MINUTES = 30;
export const READY_BUYER_HANDOFF_MODE = 'vanilla_opus_checkout';

const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'gbraid',
  'wbraid',
  'first_landing_path',
  'latest_landing_path',
  'landing_path',
  'referrer',
  'attribution_timestamp',
  'last_paid_click_timestamp',
  'source_type'
];

const TIME_WINDOWS = new Set([
  'Weekday mornings',
  'Weekday afternoons',
  'Weekday evenings',
  'Saturday',
  'Flexible / not sure'
]);

let pool;

function env(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
    const value = Netlify.env.get(name);
    if (value) return value;
  }
  if (typeof process !== 'undefined' && process.env) return process.env[name] || '';
  return '';
}

export function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return '';
  const [rawLocal, rawDomain] = email.split('@');
  const domain = rawDomain === 'googlemail.com' ? 'gmail.com' : rawDomain;
  let local = rawLocal;
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  return `${local}@${domain}`;
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(value || '').trim().startsWith('+') && digits.length >= 10) return `+${digits}`;
  return '';
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

export function parseAttribution(value) {
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value || '{}');
    } catch (error) {
      raw = {};
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const attribution = {};
  ATTRIBUTION_KEYS.forEach((key) => {
    const item = clean(raw[key], 500);
    if (item) attribution[key] = item;
  });
  return attribution;
}

export function attributionSourceLabel(attribution) {
  const source = clean(attribution?.utm_source, 100).toLowerCase();
  const medium = clean(attribution?.utm_medium, 100).toLowerCase();
  const hasGoogleClick = Boolean(attribution?.gclid || attribution?.gbraid || attribution?.wbraid);
  const isPaid = /^(cpc|ppc|paid|paid[-_ ]?search|sem)$/.test(medium);
  if (hasGoogleClick || (source.includes('google') && isPaid)) return 'Google Ads';
  if ((source.includes('facebook') || source.includes('meta') || source.includes('instagram')) && isPaid) {
    return 'Meta Ads';
  }
  if (source) return medium ? `${source} / ${medium}` : source;
  if (attribution?.referrer) {
    try {
      return `Referral: ${new URL(attribution.referrer).hostname}`;
    } catch (error) {
      return 'Referral';
    }
  }
  return 'Unknown';
}

export function attributionSummary(attribution) {
  const lines = [`Source: ${attributionSourceLabel(attribution)}`];
  const optional = [
    ['Campaign', attribution?.utm_campaign],
    ['Content', attribution?.utm_content],
    ['Search term', attribution?.utm_term],
    ['Click ID', attribution?.gclid || attribution?.gbraid || attribution?.wbraid],
    ['First landing page', attribution?.first_landing_path],
    ['Latest landing page', attribution?.latest_landing_path || attribution?.landing_path],
    ['Referrer', attribution?.referrer]
  ];
  optional.forEach(([label, value]) => {
    if (value) lines.push(`${label}: ${clean(value, 500)}`);
  });
  return lines.join('\n');
}

function parseBirthdate(value) {
  const birthdate = clean(value, 10);
  if (!birthdate) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return null;
  const date = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date > new Date()) return null;
  return birthdate;
}

export function normalizeSubmission(source) {
  const raw = source && typeof source === 'object' ? source : {};
  const location = pianoBookingLocation(raw.preferred_location || raw.preferred_location_slug);
  const existingFamilyRaw = clean(raw.existing_family, 10).toLowerCase();
  const studentBirthdate = parseBirthdate(raw.student_birthdate);
  const studentAge = clean(raw.student_age, 3);
  const submittedAtCandidate = new Date(clean(raw.submitted_at, 50));

  return {
    formName: clean(raw['form-name'] || raw.form_name, 100),
    botField: clean(raw['bot-field'] || raw.bot_field, 200),
    clientSubmissionId: clean(raw.client_submission_id, 96),
    parentName: clean(raw.parent_name, 160),
    parentEmail: clean(raw.parent_email || raw.email, 254).toLowerCase(),
    parentPhone: clean(raw.parent_phone || raw.phone, 40),
    studentName: clean(raw.student_name, 160),
    studentBirthdate,
    studentAge,
    preferredLocation: location,
    preferredTimeWindow: clean(raw.preferred_time_window, 80),
    existingFamily: existingFamilyRaw === 'yes' || existingFamilyRaw === 'true' || existingFamilyRaw === '1',
    existingFamilyAnswered: ['yes', 'no', 'true', 'false', '1', '0'].includes(existingFamilyRaw),
    attribution: parseAttribution(raw.attribution || raw.attribution_json),
    submittedAt: Number.isNaN(submittedAtCandidate.getTime())
      ? new Date().toISOString()
      : submittedAtCandidate.toISOString()
  };
}

export function validateSubmission(fields) {
  if (fields.formName && fields.formName !== PIANO_PREREGISTRATION_FORM) {
    return { ok: false, status: 400, error: 'Unexpected form.' };
  }
  if (fields.botField) return { ok: true, bot: true };
  const required = [
    ['client_submission_id', fields.clientSubmissionId],
    ['parent_name', fields.parentName],
    ['parent_email', fields.parentEmail],
    ['parent_phone', fields.parentPhone],
    ['student_name', fields.studentName],
    ['preferred_location', fields.preferredLocation],
    ['preferred_time_window', fields.preferredTimeWindow]
  ];
  const missing = required.filter(([, value]) => !value).map(([key]) => key);
  if (!fields.existingFamilyAnswered) missing.push('existing_family');
  if (!fields.studentBirthdate && !fields.studentAge) missing.push('student_birthdate_or_age');
  if (missing.length) return { ok: false, status: 422, error: `Missing required field: ${missing.join(', ')}` };
  if (!/^[a-zA-Z0-9_-]{12,96}$/.test(fields.clientSubmissionId)) {
    return { ok: false, status: 422, error: 'Invalid submission identifier.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.parentEmail)) {
    return { ok: false, status: 422, error: 'A valid parent email is required.' };
  }
  if (!normalizePhone(fields.parentPhone)) {
    return { ok: false, status: 422, error: 'A valid parent phone is required.' };
  }
  if (fields.studentBirthdate === null) {
    return { ok: false, status: 422, error: 'Student birthdate is invalid.' };
  }
  if (fields.studentAge && (!/^\d{1,2}$/.test(fields.studentAge) || Number(fields.studentAge) < 2 || Number(fields.studentAge) > 99)) {
    return { ok: false, status: 422, error: 'Student age must be between 2 and 99.' };
  }
  if (!TIME_WINDOWS.has(fields.preferredTimeWindow)) {
    return { ok: false, status: 422, error: 'Preferred time window is invalid.' };
  }
  return { ok: true };
}

export function generateLeadId(now = new Date(), uuid = crypto.randomUUID()) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `CSM-PRE-${date}-${uuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function dedupeFingerprint(fields) {
  return crypto.createHash('sha256').update([
    normalizeEmail(fields.parentEmail),
    normalizePhone(fields.parentPhone),
    'piano',
    fields.preferredLocation.slug
  ].join('|')).digest('hex');
}

export function buildStudentNote({ fields, leadId, submittedAt }) {
  const lines = [
    `Source: ${attributionSourceLabel(fields.attribution)}`,
    'Instrument: Piano',
    `Preferred location: ${fields.preferredLocation.name}`,
    `Preferred time window: ${fields.preferredTimeWindow}`,
    `CSM pre-registration timestamp: ${submittedAt}`,
    `CSM lead ID: ${leadId}`
  ];
  if (fields.studentBirthdate) lines.push(`Student birthdate: ${fields.studentBirthdate}`);
  else if (fields.studentAge) lines.push(`Student age: ${fields.studentAge}`);
  lines.push('Parent still needs to complete the normal Opus booking/payment flow.');
  lines.push('CSM did not pre-create an Opus parent or student for this ready-to-book lead.');
  return lines.join('\n');
}

function publicResult(record, extra = {}) {
  return {
    ok: true,
    stored: true,
    lead_id: record.csm_lead_id,
    booking_url: record.booking_url,
    location: record.preferred_location,
    location_slug: record.preferred_location_slug,
    opus_post_status: record.opus_post_status,
    handoff_mode: READY_BUYER_HANDOFF_MODE,
    opus_client_create_attempted: false,
    reconciliation_status: record.reconciliation_status || (record.existing_family ? 'existing_family_office' : 'pending'),
    conversion_eligible: record.conversion_eligible !== false,
    office_follow_up_required: Boolean(record.office_follow_up_required),
    duplicate_detected: Boolean(record.duplicate_of_lead_id),
    existing_family: Boolean(record.existing_family),
    ...extra
  };
}

function postgresPool() {
  let connectionString = env('DATABASE_URL') || env('POSTGRES_URL') || env('NETLIFY_DATABASE_URL');
  if (!connectionString) {
    try {
      connectionString = getConnectionString();
    } catch (error) {
      connectionString = '';
    }
  }
  if (!connectionString) throw new Error('DATABASE_URL or POSTGRES_URL is not configured.');
  if (!pool) {
    const ssl = /sslmode=require|neon\.tech|supabase\./i.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined;
    pool = new Pool({ connectionString, ssl, max: 3 });
  }
  return pool;
}

export function createPostgresPreregistrationRepository() {
  const db = postgresPool();
  return {
    async createLead(input) {
      const existing = await db.query(
        'SELECT * FROM piano_preregistrations WHERE client_submission_id = $1',
        [input.clientSubmissionId]
      );
      if (existing.rows[0]) return { record: existing.rows[0], created: false, replay: true };

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.dedupeFingerprint]);
        const replay = await client.query(
          'SELECT * FROM piano_preregistrations WHERE client_submission_id = $1',
          [input.clientSubmissionId]
        );
        if (replay.rows[0]) {
          await client.query('COMMIT');
          return { record: replay.rows[0], created: false, replay: true };
        }
        const duplicate = await client.query(
          `SELECT csm_lead_id
           FROM piano_preregistrations
           WHERE dedupe_fingerprint = $1
             AND created_at >= now() - ($2::text || ' minutes')::interval
           ORDER BY created_at DESC
           LIMIT 1`,
          [input.dedupeFingerprint, DUPLICATE_WINDOW_MINUTES]
        );
        const duplicateOfLeadId = duplicate.rows[0]?.csm_lead_id || null;
        const opusStatus = input.existingFamily
          ? 'skipped_existing_family'
          : duplicateOfLeadId
            ? 'not_attempted_recent_duplicate'
            : 'not_attempted_vanilla_handoff';
        const officeFollowUpRequired = input.existingFamily;
        const inserted = await client.query(
          `INSERT INTO piano_preregistrations (
             csm_lead_id, client_submission_id,
             parent_name, parent_email, parent_email_norm, parent_phone, parent_phone_norm,
             student_name, student_birthdate, student_age, instrument,
             preferred_location, preferred_location_slug, preferred_time_window,
             existing_family, booking_url, attribution, attribution_summary, student_note,
             dedupe_fingerprint, duplicate_of_lead_id, opus_payload, opus_post_status,
             office_follow_up_required, reconciliation_status, reconciliation_reason,
             reconciliation_manual_review_required, conversion_eligible,
             conversion_exclusion_reason, submitted_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9::date, $10, 'Piano',
             $11, $12, $13, $14, $15, $16::jsonb, $17, $18,
             $19, $20, $21::jsonb, $22, $23, $24, $25, $26, $27, $28, $29
           ) RETURNING *`,
          [
            input.leadId,
            input.clientSubmissionId,
            input.parentName,
            input.parentEmail,
            input.parentEmailNorm,
            input.parentPhone,
            input.parentPhoneNorm,
            input.studentName,
            input.studentBirthdate || null,
            input.studentAge || null,
            input.preferredLocation,
            input.preferredLocationSlug,
            input.preferredTimeWindow,
            input.existingFamily,
            input.bookingUrl,
            JSON.stringify(input.attribution),
            input.attributionSummary,
            input.studentNote,
            input.dedupeFingerprint,
            duplicateOfLeadId,
            JSON.stringify({}),
            opusStatus,
            officeFollowUpRequired,
            input.existingFamily ? 'existing_family_office' : 'pending',
            input.existingFamily ? 'existing_family_launch_path' : null,
            input.existingFamily,
            input.conversionEligible,
            input.conversionExclusionReason || null,
            input.submittedAt
          ]
        );
        await client.query('COMMIT');
        return { record: inserted.rows[0], created: true, replay: false };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async recordOfficeNotification(leadId, payload, result) {
      const updated = await db.query(
        `UPDATE piano_preregistrations
         SET office_notification_status = $2,
             office_notification_payload = $3::jsonb,
             office_notification_error = $4,
             office_notified_at = CASE WHEN $2 = 'sent' THEN now() ELSE office_notified_at END,
             office_follow_up_required = office_follow_up_required OR $5,
             updated_at = now()
         WHERE csm_lead_id = $1
         RETURNING *`,
        [leadId, result.status, JSON.stringify(payload), result.error || null, result.status !== 'sent']
      );
      return updated.rows[0];
    }
  };
}

export function buildOfficeNotification(record) {
  return {
    'form-name': PIANO_PREREGISTRATION_FORM,
    client_submission_id: record.client_submission_id,
    csm_lead_id: record.csm_lead_id,
    submitted_at: new Date(record.submitted_at).toISOString(),
    existing_family: record.existing_family ? 'Yes — office follow-up required' : 'No',
    duplicate_of_lead_id: record.duplicate_of_lead_id || '',
    parent_name: record.parent_name,
    parent_email: record.parent_email,
    parent_phone: record.parent_phone,
    student_name: record.student_name,
    student_birthdate: record.student_birthdate ? String(record.student_birthdate).slice(0, 10) : '',
    student_age: record.student_age || '',
    instrument: 'Piano',
    preferred_location: record.preferred_location,
    preferred_time_window: record.preferred_time_window,
    booking_url: record.booking_url,
    handoff_mode: READY_BUYER_HANDOFF_MODE,
    opus_client_create_attempted: 'No',
    opus_post_status: record.opus_post_status,
    reconciliation_status: record.reconciliation_status || (record.existing_family ? 'existing_family_office' : 'pending'),
    conversion_eligible: record.conversion_eligible === false ? 'No' : 'Yes',
    conversion_exclusion_reason: record.conversion_exclusion_reason || '',
    office_follow_up_required: record.office_follow_up_required ? 'Yes' : 'No',
    attribution_summary: record.attribution_summary,
    csm_context: record.student_note
  };
}

export function createPianoPreregistrationBridge({
  repository,
  notifyOffice,
  config = {},
  now = () => new Date(),
  uuid = () => crypto.randomUUID()
}) {
  return async function submit(rawFields) {
    const fields = normalizeSubmission(rawFields);
    const validation = validateSubmission(fields);
    if (validation.bot) return { ok: true, skipped: true, reason: 'honeypot' };
    if (!validation.ok) return validation;

    const submittedAt = fields.submittedAt || now().toISOString();
    const leadId = generateLeadId(now(), uuid());
    const studentNote = buildStudentNote({ fields, leadId, submittedAt });
    const created = await repository.createLead({
      leadId,
      clientSubmissionId: fields.clientSubmissionId,
      parentName: fields.parentName,
      parentEmail: fields.parentEmail,
      parentEmailNorm: normalizeEmail(fields.parentEmail),
      parentPhone: fields.parentPhone,
      parentPhoneNorm: normalizePhone(fields.parentPhone),
      studentName: fields.studentName,
      studentBirthdate: fields.studentBirthdate || '',
      studentAge: fields.studentAge,
      preferredLocation: fields.preferredLocation.name,
      preferredLocationSlug: fields.preferredLocation.slug,
      preferredTimeWindow: fields.preferredTimeWindow,
      existingFamily: fields.existingFamily,
      bookingUrl: fields.preferredLocation.bookingUrl,
      attribution: fields.attribution,
      attributionSummary: attributionSummary(fields.attribution),
      studentNote,
      dedupeFingerprint: dedupeFingerprint(fields),
      conversionEligible: config.conversionEligible !== false,
      conversionExclusionReason: config.conversionEligible === false
        ? clean(config.conversionExclusionReason || 'non_production_test', 160)
        : '',
      submittedAt
    });

    if (created.replay) return publicResult(created.record, { replay: true });

    let record = created.record;

    const notificationPayload = buildOfficeNotification(record);
    let notificationResult = { status: 'disabled_preview' };
    if (config.officeEmailEnabled && notifyOffice) {
      try {
        await notifyOffice(notificationPayload, record);
        notificationResult = { status: 'sent' };
      } catch (error) {
        notificationResult = { status: 'failed', error: clean(error?.message || error, 1000) };
      }
    }
    record = await repository.recordOfficeNotification(record.csm_lead_id, notificationPayload, notificationResult);
    return publicResult(record, { replay: false });
  };
}

export const testables = {
  ATTRIBUTION_KEYS,
  TIME_WINDOWS,
  attributionSourceLabel,
  attributionSummary,
  buildOfficeNotification,
  buildStudentNote,
  dedupeFingerprint,
  generateLeadId,
  normalizeSubmission,
  parseAttribution,
  validateSubmission
};
