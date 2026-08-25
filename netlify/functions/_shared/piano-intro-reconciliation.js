import crypto from 'node:crypto';
import { getConnectionString } from '@netlify/database';
import pg from 'pg';
import { normalizeEmail, normalizePhone } from './piano-preregistration.js';

const { Pool } = pg;

export const PIANO_INTRO_AMOUNT_CENTS = 4200;
export const PIANO_INTRO_CURRENCY = 'usd';
export const PIANO_INTRO_SERVICE_ID = '567f7305-b997-46cd-b24b-60b129879ef8';

const PAID_VALUES = new Set(['paid', 'succeeded', 'successful', 'complete', 'completed', 'settled']);
const BOOKED_VALUES = new Set(['active', 'booked', 'confirmed', 'complete', 'completed', 'scheduled']);
const EVENT_TYPES = new Set([
  'client_create',
  'client_update',
  'subscription_create',
  'subscription_update',
  'booking_create',
  'booking_update',
  'payment_create',
  'payment_update',
  'invoice_create',
  'invoice_update'
]);
const STRIPE_EVENT_TYPES = new Set(['customer.updated', 'payment_intent.succeeded']);

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

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanId(value) {
  return clean(value, 160);
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function finalKey(path) {
  return String(path || '').split('.').pop().replace(/\[\d+\]$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function flatten(value, path = '', output = [], depth = 0) {
  if (depth > 10 || output.length > 2000) return output;
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, output, depth + 1));
    return output;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => flatten(item, path ? `${path}.${key}` : key, output, depth + 1));
    return output;
  }
  output.push({ path, key: finalKey(path), value });
  return output;
}

function valueFor(pairs, keys) {
  const normalized = keys.map((key) => finalKey(key));
  for (const key of normalized) {
    const found = pairs.find((pair) => pair.key === key && clean(pair.value));
    if (found) return clean(found.value);
  }
  return '';
}

function allValuesFor(pairs, keys) {
  const normalized = new Set(keys.map((key) => finalKey(key)));
  return pairs.filter((pair) => normalized.has(pair.key)).map((pair) => clean(pair.value)).filter(Boolean);
}

function valueForPath(pairs, patterns) {
  for (const pattern of patterns) {
    const found = pairs.find((pair) => pattern.test(pair.path) && clean(pair.value));
    if (found) return clean(found.value);
  }
  return '';
}

function normalizeName(value) {
  return clean(value, 200).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

function normalizeLocation(value) {
  return clean(value, 200).toLowerCase().replace(/^csm\s+/, '').replace(/[^a-z0-9]/g, '');
}

function normalizeEventType(value) {
  const compact = clean(value, 120).toLowerCase().replace(/[-\s]+/g, '_').replace(/_trigger$/g, '');
  if (/subscription.*create|create.*subscription/.test(compact)) return 'subscription_create';
  if (/subscription.*update|update.*subscription/.test(compact)) return 'subscription_update';
  if (/client.*create|customer.*create|member.*create|create.*client/.test(compact)) return 'client_create';
  if (/client.*update|customer.*update|member.*update|update.*client/.test(compact)) return 'client_update';
  if (/booking.*create|appointment.*create|create.*booking|create.*appointment/.test(compact)) return 'booking_create';
  if (/booking.*update|appointment.*update|update.*booking|update.*appointment/.test(compact)) return 'booking_update';
  if (/payment.*create|transaction.*create|create.*payment|create.*transaction/.test(compact)) return 'payment_create';
  if (/payment.*update|transaction.*update|update.*payment|update.*transaction/.test(compact)) return 'payment_update';
  if (/invoice.*create|create.*invoice/.test(compact)) return 'invoice_create';
  if (/invoice.*update|update.*invoice/.test(compact)) return 'invoice_update';
  return compact || 'unknown';
}

function amountToCents(value, key = '') {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(number) || number < 0) return null;
  if (/cent/i.test(key)) return Math.round(number);
  return number < 1000 ? Math.round(number * 100) : Math.round(number);
}

function findAmountCents(pairs) {
  const priority = [
    'amount_paid_cents',
    'amount_total_cents',
    'payment_amount_cents',
    'price_cents',
    'amount_paid',
    'amount_total',
    'payment_amount',
    'price',
    'amount'
  ];
  for (const key of priority) {
    const pair = pairs.find((item) => item.key === finalKey(key) && clean(item.value));
    if (!pair) continue;
    const cents = amountToCents(pair.value, key);
    if (cents !== null) return cents;
  }
  return null;
}

function explicitPaidSignal(pairs) {
  const statusKeys = new Set([
    'paymentstatus',
    'invoicestatus',
    'transactionstatus',
    'chargestatus',
    'paymentstate'
  ]);
  if (pairs.some((pair) => statusKeys.has(pair.key) && PAID_VALUES.has(clean(pair.value).toLowerCase()))) return true;
  if (pairs.some((pair) => ['ispaid', 'paid'].includes(pair.key) && ['1', 'true', 'yes'].includes(clean(pair.value).toLowerCase()))) return true;
  if (valueFor(pairs, ['paid_at', 'paidAt', 'payment_completed_at'])) return true;
  const amountPaid = pairs.find((pair) => ['amountpaid', 'amountpaidcents'].includes(pair.key));
  return amountPaid ? (amountToCents(amountPaid.value, amountPaid.path) || 0) >= PIANO_INTRO_AMOUNT_CENTS : false;
}

function bookedSignal(pairs, eventType, subscriptionId, bookingId) {
  const statuses = allValuesFor(pairs, ['booking_status', 'appointment_status', 'subscription_status', 'status'])
    .map((value) => value.toLowerCase());
  if (statuses.some((value) => BOOKED_VALUES.has(value))) return true;
  if ((eventType.startsWith('subscription_') && subscriptionId) || (eventType.startsWith('booking_') && bookingId)) return true;
  return false;
}

function serviceIsPianoIntro(pairs, serviceId, serviceName) {
  if (serviceId === PIANO_INTRO_SERVICE_ID) return true;
  const corpus = pairs.map((pair) => clean(pair.value, 300).toLowerCase()).join(' | ');
  const explicitPianoIntro = /piano[^|]{0,80}intro|intro[^|]{0,80}piano/.test(corpus);
  const singleVisitIntro = /single\s+visit\s*-?\s*intro/.test(corpus) && /piano/.test(corpus);
  return explicitPianoIntro || singleVisitIntro || (/piano/.test(serviceName.toLowerCase()) && /intro/.test(serviceName.toLowerCase()));
}

function inferParentName(pairs) {
  const full = valueFor(pairs, ['parent_name', 'parent1_name', 'account_manager_name', 'primary_contact_name']);
  if (full) return full;
  const first = valueFor(pairs, ['parent_first_name', 'parent1_first_name', 'account_manager_first_name']);
  const last = valueFor(pairs, ['parent_last_name', 'parent1_last_name', 'account_manager_last_name']);
  return [first, last].filter(Boolean).join(' ');
}

function inferStudentName(pairs) {
  const full = valueFor(pairs, ['student_name', 'dependent_name', 'participant_name', 'client_name']) ||
    valueForPath(pairs, [/(student|dependent|participant)\.name$/i]);
  if (full) return full;
  const first = valueFor(pairs, ['student_first_name', 'dependent_first_name', 'participant_first_name']) ||
    valueForPath(pairs, [/(student|dependent|participant)\.(first_name|firstName)$/i]) ||
    valueFor(pairs, ['first_name']);
  const last = valueFor(pairs, ['student_last_name', 'dependent_last_name', 'participant_last_name']) ||
    valueForPath(pairs, [/(student|dependent|participant)\.(last_name|lastName)$/i]) ||
    valueFor(pairs, ['last_name']);
  return [first, last].filter(Boolean).join(' ');
}

export function extractOpusEvidence(payload, headers = {}) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const pairs = flatten(body);
  const eventType = normalizeEventType(
    valueFor(pairs, ['event_type', 'eventType', 'event', 'type', 'trigger', 'action']) ||
      headers['x-opus-event'] ||
      headers['x-opus-trigger']
  );
  const clientId = cleanId(valueFor(pairs, ['client_id', 'clientId', 'customer_id', 'account_manager_id']) ||
    (eventType.startsWith('client_') ? valueFor(pairs, ['id']) : ''));
  const studentId = cleanId(valueFor(pairs, ['student_id', 'dependent_id', 'participant_id', 'member_id']) ||
    valueForPath(pairs, [/(student|dependent|participant|member)\.id$/i]));
  const subscriptionId = cleanId(valueFor(pairs, ['subscription_id', 'subscriptionId']) ||
    (eventType.startsWith('subscription_') ? valueFor(pairs, ['id']) : ''));
  const bookingId = cleanId(valueFor(pairs, ['booking_id', 'appointment_id', 'schedule_id', 'lesson_id', 'visit_id']) ||
    valueForPath(pairs, [/(booking|appointment|schedule|lesson|visit)\.id$/i]));
  const invoiceId = cleanId(valueFor(pairs, ['invoice_id', 'invoiceId']));
  const paymentId = cleanId(valueFor(pairs, ['payment_id', 'transaction_id', 'charge_id', 'payment_intent_id']));
  const serviceId = cleanId(valueFor(pairs, ['service_id', 'serviceId', 'lesson_service_id']) ||
    valueForPath(pairs, [/(service|offering|program)\.id$/i]));
  const serviceName = valueFor(pairs, ['service_name', 'serviceName', 'plan_name', 'planName', 'program_name', 'offering_name', 'title']) ||
    valueForPath(pairs, [/(service|offering|program|plan)\.name$/i]);
  const locationName = valueFor(pairs, ['location_name', 'locationName', 'studio_name', 'branch_name']) ||
    valueForPath(pairs, [/(location|studio|branch)\.name$/i]);
  const emailRaw = valueFor(pairs, ['parent1_email', 'parent_email', 'account_manager_email', 'primary_email', 'email_address', 'email']);
  const phoneRaw = valueFor(pairs, ['parent1_primary_phone', 'parent1_phone', 'parent_phone', 'account_manager_phone', 'primary_phone', 'mobile_phone', 'phone']);
  const amountCents = findAmountCents(pairs);
  const currency = clean(valueFor(pairs, ['currency', 'currency_code']) || PIANO_INTRO_CURRENCY, 10).toLowerCase();
  const paidAt = safeDate(valueFor(pairs, ['paid_at', 'payment_completed_at', 'completed_at', 'created_at', 'createdAt']));
  const bookingStartAt = safeDate(valueFor(pairs, ['booking_start_at', 'appointment_start_at', 'start_at', 'startAt', 'scheduled_at']));
  const paymentStatus = explicitPaidSignal(pairs) ? 'paid' : 'unverified';
  const bookingStatus = bookedSignal(pairs, eventType, subscriptionId, bookingId) ? 'booked' : 'unverified';
  const pianoIntro = serviceIsPianoIntro(pairs, serviceId, serviceName);
  const expectedAmount = amountCents === null || amountCents === PIANO_INTRO_AMOUNT_CENTS;
  const expectedCurrency = !currency || currency === PIANO_INTRO_CURRENCY;
  const verifiedPaidIntro = EVENT_TYPES.has(eventType) && pianoIntro && paymentStatus === 'paid' && bookingStatus === 'booked' && expectedAmount && expectedCurrency;

  return {
    eventType,
    externalId: subscriptionId || bookingId || paymentId || invoiceId || clientId || '',
    opusClientId: clientId,
    opusStudentId: studentId,
    opusSubscriptionId: subscriptionId,
    opusBookingId: bookingId,
    opusInvoiceId: invoiceId,
    opusPaymentId: paymentId,
    parentEmailNorm: normalizeEmail(emailRaw),
    parentPhoneNorm: normalizePhone(phoneRaw),
    parentName: inferParentName(pairs),
    studentName: inferStudentName(pairs),
    serviceId,
    serviceName,
    locationName,
    bookingStartAt,
    paidAt,
    amountCents,
    currency,
    bookingStatus,
    paymentStatus,
    pianoIntro,
    verifiedPaidIntro,
    verificationChecks: {
      recognized_event_type: EVENT_TYPES.has(eventType),
      piano_intro: pianoIntro,
      explicit_paid: paymentStatus === 'paid',
      booked: bookingStatus === 'booked',
      expected_amount: expectedAmount,
      expected_currency: expectedCurrency
    }
  };
}

export function extractStripeEvidence(event) {
  const stripeEvent = event && typeof event === 'object' ? event : {};
  const object = stripeEvent.data?.object && typeof stripeEvent.data.object === 'object'
    ? stripeEvent.data.object
    : {};
  const eventType = clean(stripeEvent.type, 120).toLowerCase();
  const customerId = cleanId(object.customer || (object.object === 'customer' ? object.id : ''));
  const paymentIntentId = cleanId(object.object === 'payment_intent' ? object.id : '');
  const serviceName = clean(object.description, 300);
  const amountCents = object.amount_received ?? object.amount ?? null;
  const currency = clean(object.currency, 10).toLowerCase();
  const status = clean(object.status, 40).toLowerCase();
  const locationId = cleanId(object.metadata?.location_id);
  const orderId = cleanId(object.metadata?.order_id);
  const opusClientId = cleanId(object.metadata?.id);
  const parentEmailNorm = normalizeEmail(object.email);
  const paidAt = eventType === 'payment_intent.succeeded' && stripeEvent.created
    ? safeDate(Number(stripeEvent.created) * 1000)
    : null;
  const pianoIntro = /piano/.test(serviceName.toLowerCase()) &&
    (/intro/.test(serviceName.toLowerCase()) || /single\s+visit/.test(serviceName.toLowerCase()));
  const expectedAmount = Number(amountCents) === PIANO_INTRO_AMOUNT_CENTS;
  const expectedCurrency = currency === PIANO_INTRO_CURRENCY;
  const businessIsCsm = clean(object.metadata?.business, 120).toLowerCase() === 'cincinnatischoolofmusic';
  const verifiedPaidIntro = eventType === 'payment_intent.succeeded' &&
    status === 'succeeded' && pianoIntro && expectedAmount && expectedCurrency && businessIsCsm &&
    Boolean(customerId && locationId && orderId && paymentIntentId);

  return {
    source: 'stripe',
    eventType,
    externalId: cleanId(stripeEvent.id || paymentIntentId || customerId),
    stripeEventId: cleanId(stripeEvent.id),
    stripeCustomerId: customerId,
    stripePaymentIntentId: paymentIntentId,
    opusOrderId: orderId,
    opusLocationId: locationId,
    opusClientId,
    opusStudentId: '',
    opusSubscriptionId: '',
    opusBookingId: orderId,
    opusInvoiceId: '',
    opusPaymentId: paymentIntentId,
    parentEmailNorm,
    parentPhoneNorm: normalizePhone(object.phone),
    parentName: clean(object.description, 200),
    studentName: '',
    serviceId: '',
    serviceName,
    locationName: '',
    bookingStartAt: null,
    paidAt,
    amountCents: Number.isFinite(Number(amountCents)) ? Number(amountCents) : null,
    currency,
    bookingStatus: verifiedPaidIntro ? 'booked' : 'unverified',
    paymentStatus: verifiedPaidIntro ? 'paid' : 'unverified',
    pianoIntro,
    verifiedPaidIntro,
    verificationChecks: {
      recognized_event_type: STRIPE_EVENT_TYPES.has(eventType),
      csm_business_metadata: businessIsCsm,
      piano_intro: pianoIntro,
      explicit_paid: status === 'succeeded',
      booked: verifiedPaidIntro,
      expected_amount: expectedAmount,
      expected_currency: expectedCurrency,
      customer_join_key: Boolean(customerId),
      opus_order_id: Boolean(orderId),
      opus_location_id: Boolean(locationId)
    }
  };
}

export function eventDedupeKey(evidence, payload) {
  const stable = evidence.externalId
    ? `${evidence.eventType}|${evidence.externalId}`
    : `${evidence.eventType}|${JSON.stringify(payload || {})}`;
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function mergeIdentity(current, prior = []) {
  const merged = { ...current };
  for (const evidence of prior) {
    if (!merged.opusClientId && evidence.opusClientId) merged.opusClientId = evidence.opusClientId;
    if (!merged.parentEmailNorm && evidence.parentEmailNorm) merged.parentEmailNorm = evidence.parentEmailNorm;
    if (!merged.parentPhoneNorm && evidence.parentPhoneNorm) merged.parentPhoneNorm = evidence.parentPhoneNorm;
    if (!merged.parentName && evidence.parentName) merged.parentName = evidence.parentName;
    if (!merged.studentName && evidence.studentName) merged.studentName = evidence.studentName;
    if (!merged.opusStudentId && evidence.opusStudentId) merged.opusStudentId = evidence.opusStudentId;
  }
  return merged;
}

function sanityConflicts(lead, evidence, eventAt = new Date().toISOString()) {
  const conflicts = [];
  if (evidence.studentName && normalizeName(lead.student_name) !== normalizeName(evidence.studentName)) {
    conflicts.push('student_identity_conflict');
  }
  if (evidence.locationName) {
    const evidenceLocation = normalizeLocation(evidence.locationName);
    const leadLocation = normalizeLocation(lead.preferred_location_slug || lead.preferred_location);
    if (evidenceLocation && leadLocation && !evidenceLocation.includes(leadLocation) && !leadLocation.includes(evidenceLocation)) {
      conflicts.push('location_conflict');
    }
  }
  const leadAt = new Date(lead.submitted_at).getTime();
  const opusAt = new Date(evidence.paidAt || eventAt).getTime();
  if (Number.isFinite(leadAt) && Number.isFinite(opusAt) && opusAt < leadAt - 10 * 60 * 1000) {
    conflicts.push('timing_conflict');
  }
  return conflicts;
}

export function chooseReconciliationMatch({ evidence, emailCandidates = [], phoneCandidates = [], eventAt }) {
  const allManual = (reason, candidates) => ({
    action: 'manual_review',
    reason,
    candidateLeadIds: [...new Set(candidates.map((item) => item.csm_lead_id))]
  });
  const evaluateOne = (candidate, method) => {
    if (candidate.existing_family) return allManual('existing_family_launch_path', [candidate]);
    if (method === 'email' && evidence.parentPhoneNorm && candidate.parent_phone_norm !== evidence.parentPhoneNorm) {
      return allManual('phone_conflict_after_email_match', [candidate]);
    }
    if (method === 'phone' && evidence.parentEmailNorm && candidate.parent_email_norm !== evidence.parentEmailNorm) {
      return allManual('email_conflict_after_phone_match', [candidate]);
    }
    const conflicts = sanityConflicts(candidate, evidence, eventAt);
    if (conflicts.length) return allManual(conflicts.join(','), [candidate]);
    return { action: 'match', method, lead: candidate };
  };

  if (evidence.parentEmailNorm) {
    if (emailCandidates.length > 1) return allManual('multiple_exact_email_candidates', emailCandidates);
    if (emailCandidates.length === 1) return evaluateOne(emailCandidates[0], 'email');
    if (phoneCandidates.length) return allManual('email_conflict_phone_candidate_exists', phoneCandidates);
    return { action: 'no_match', reason: 'no_exact_email_candidate' };
  }

  if (evidence.parentPhoneNorm) {
    if (phoneCandidates.length > 1) return allManual('multiple_exact_phone_candidates', phoneCandidates);
    if (phoneCandidates.length === 1) return evaluateOne(phoneCandidates[0], 'phone');
    return { action: 'no_match', reason: 'no_exact_phone_candidate' };
  }

  return { action: 'manual_review', reason: 'missing_exact_email_and_phone', candidateLeadIds: [] };
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
  if (!connectionString) throw new Error('A database connection is not configured.');
  if (!pool) {
    const ssl = /sslmode=require|netlify\.com|neon\.tech|supabase\./i.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined;
    pool = new Pool({ connectionString, ssl, max: 3 });
  }
  return pool;
}

export function createPostgresReconciliationRepository() {
  const db = postgresPool();
  return {
    async createEvent({ dedupeKey, evidence, payload }) {
      const inserted = await db.query(
        `INSERT INTO piano_intro_opus_events (
           dedupe_key, event_type, external_id, opus_client_id, opus_student_id,
           opus_subscription_id, opus_booking_id, payload, evidence
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING *`,
        [
          dedupeKey,
          evidence.eventType,
          evidence.externalId || null,
          evidence.opusClientId || null,
          evidence.opusStudentId || null,
          evidence.opusSubscriptionId || null,
          evidence.opusBookingId || null,
          JSON.stringify(payload || {}),
          JSON.stringify(evidence)
        ]
      );
      if (inserted.rows[0]) return { record: inserted.rows[0], created: true };
      const existing = await db.query('SELECT * FROM piano_intro_opus_events WHERE dedupe_key = $1', [dedupeKey]);
      return { record: existing.rows[0], created: false };
    },

    async updateEvent(eventId, values) {
      const result = await db.query(
        `UPDATE piano_intro_opus_events
         SET evidence = COALESCE($2::jsonb, evidence),
             reconciliation_status = $3,
             reconciliation_reason = $4,
             match_method = $5,
             matched_csm_lead_id = $6,
             processed_at = now(),
             process_error = $7
         WHERE id = $1
         RETURNING *`,
        [
          eventId,
          values.evidence ? JSON.stringify(values.evidence) : null,
          values.status,
          values.reason || null,
          values.matchMethod || null,
          values.leadId || null,
          values.error || null
        ]
      );
      return result.rows[0];
    },

    async identityEvidence(opusClientId, beforeEventId) {
      if (!opusClientId) return [];
      const result = await db.query(
        `SELECT evidence
         FROM piano_intro_opus_events
         WHERE opus_client_id = $1 AND id <> $2
         ORDER BY received_at DESC
         LIMIT 20`,
        [opusClientId, beforeEventId]
      );
      return result.rows.map((row) => row.evidence || {});
    },

    async stripeIdentityEvidence(stripeCustomerId, beforeEventId) {
      if (!stripeCustomerId) return [];
      const result = await db.query(
        `SELECT evidence
         FROM piano_intro_opus_events
         WHERE evidence->>'stripeCustomerId' = $1 AND id <> $2
         ORDER BY received_at DESC
         LIMIT 20`,
        [stripeCustomerId, beforeEventId]
      );
      return result.rows.map((row) => row.evidence || {});
    },

    async candidates(emailNorm, phoneNorm) {
      const email = emailNorm
        ? await db.query(
          `SELECT * FROM piano_preregistrations
           WHERE parent_email_norm = $1 AND reconciliation_status <> 'matched_paid'
           ORDER BY submitted_at DESC`,
          [emailNorm]
        )
        : { rows: [] };
      const phone = phoneNorm
        ? await db.query(
          `SELECT * FROM piano_preregistrations
           WHERE parent_phone_norm = $1 AND reconciliation_status <> 'matched_paid'
           ORDER BY submitted_at DESC`,
          [phoneNorm]
        )
        : { rows: [] };
      return { emailCandidates: email.rows, phoneCandidates: phone.rows };
    },

    async alreadyMatched(evidence) {
      if (!evidence.opusSubscriptionId && !evidence.opusBookingId) return null;
      const found = await db.query(
        `SELECT * FROM piano_preregistrations
         WHERE reconciliation_status = 'matched_paid'
           AND (($1 <> '' AND matched_opus_subscription_id = $1)
             OR ($2 <> '' AND matched_opus_booking_id = $2))
         LIMIT 1`,
        [evidence.opusSubscriptionId || '', evidence.opusBookingId || '']
      );
      return found.rows[0] || null;
    },

    async markManual(leadIds, reason) {
      if (!leadIds.length) return [];
      const result = await db.query(
        `UPDATE piano_preregistrations
         SET reconciliation_status = CASE WHEN existing_family THEN 'existing_family_office' ELSE 'manual_review' END,
             reconciliation_reason = $2,
             reconciliation_manual_review_required = true,
             office_follow_up_required = true,
             updated_at = now()
         WHERE csm_lead_id = ANY($1::text[])
           AND reconciliation_status <> 'matched_paid'
         RETURNING csm_lead_id`,
        [leadIds, reason]
      );
      return result.rows.map((row) => row.csm_lead_id);
    },

    async markMatched(leadId, eventId, evidence, method) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query(
          'SELECT * FROM piano_preregistrations WHERE csm_lead_id = $1 FOR UPDATE',
          [leadId]
        );
        const lead = locked.rows[0];
        if (!lead) throw new Error('The matched CSM lead no longer exists.');
        if (lead.existing_family) throw new Error('Existing-family leads require office review.');
        if (lead.reconciliation_status === 'matched_paid') {
          await client.query('COMMIT');
          return lead;
        }
        const updated = await client.query(
          `UPDATE piano_preregistrations
           SET reconciliation_status = 'matched_paid',
               reconciliation_match_method = $2,
               reconciliation_reason = 'verified_paid_opus_piano_intro',
               reconciliation_manual_review_required = false,
               reconciled_at = now(),
               matched_opus_event_id = $3,
               matched_opus_client_id = $4,
               matched_opus_student_id = $5,
               matched_opus_subscription_id = $6,
               matched_opus_booking_id = $7,
               opus_service_name = $8,
               opus_location_name = $9,
               opus_booking_status = 'booked',
               opus_payment_status = 'paid',
               opus_booking_start_at = $10,
               opus_paid_at = COALESCE($11, now()),
               opus_amount_cents = $12,
               opus_currency = $13,
               reconciliation_evidence = $14::jsonb,
               updated_at = now()
           WHERE csm_lead_id = $1
           RETURNING *`,
          [
            leadId,
            method,
            eventId,
            evidence.opusClientId || null,
            evidence.opusStudentId || null,
            evidence.opusSubscriptionId || null,
            evidence.opusBookingId || null,
            evidence.serviceName || null,
            evidence.locationName || null,
            evidence.bookingStartAt,
            evidence.paidAt,
            evidence.amountCents,
            evidence.currency || null,
            JSON.stringify(evidence)
          ]
        );
        await client.query('COMMIT');
        return updated.rows[0];
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async getLead(leadId) {
      const result = await db.query(
        `SELECT
           csm_lead_id, client_submission_id, parent_name, parent_email, parent_phone,
           student_name, student_birthdate, student_age, instrument,
           preferred_location, preferred_location_slug, preferred_time_window,
           existing_family, booking_url, attribution, attribution_summary,
           submitted_at, created_at, updated_at, office_follow_up_required,
           reconciliation_status, reconciliation_match_method, reconciliation_reason,
           reconciliation_manual_review_required, reconciled_at, matched_opus_event_id,
           matched_opus_client_id, matched_opus_student_id, matched_opus_subscription_id,
           matched_opus_booking_id, opus_service_name, opus_location_name,
           opus_booking_status, opus_payment_status, opus_booking_start_at, opus_paid_at,
           opus_amount_cents, opus_currency, reconciliation_evidence
         FROM piano_preregistrations
         WHERE csm_lead_id = $1`,
        [leadId]
      );
      return result.rows[0] || null;
    },

    async getEvent(eventId) {
      const result = await db.query(
        `SELECT id, dedupe_key, event_type, external_id, opus_client_id,
                opus_student_id, opus_subscription_id, opus_booking_id,
                received_at, processed_at, reconciliation_status,
                reconciliation_reason, match_method, matched_csm_lead_id,
                evidence, payload, process_error
         FROM piano_intro_opus_events
         WHERE id = $1`,
        [eventId]
      );
      return result.rows[0] || null;
    },

    async listEvents(limit = 20) {
      const result = await db.query(
        `SELECT id, event_type, external_id, opus_client_id, opus_student_id,
                opus_subscription_id, opus_booking_id, received_at, processed_at,
                reconciliation_status, reconciliation_reason, match_method,
                matched_csm_lead_id, evidence, payload, process_error
         FROM piano_intro_opus_events
         ORDER BY received_at DESC
         LIMIT $1`,
        [Math.min(Math.max(Number(limit) || 20, 1), 100)]
      );
      return result.rows;
    },

    async listManual(limit = 50) {
      const result = await db.query(
        `SELECT csm_lead_id, parent_name, parent_email, parent_phone, student_name,
                preferred_location, submitted_at, reconciliation_status,
                reconciliation_reason, office_follow_up_required
         FROM piano_preregistrations
         WHERE reconciliation_manual_review_required = true
         ORDER BY updated_at DESC
         LIMIT $1`,
        [Math.min(Math.max(Number(limit) || 50, 1), 100)]
      );
      return result.rows;
    }
  };
}

export function createPianoIntroReconciler({ repository, now = () => new Date() }) {
  return async function reconcile(payload, headers = {}, options = {}) {
    const initialEvidence = options.source === 'stripe'
      ? extractStripeEvidence(payload)
      : extractOpusEvidence(payload, headers);
    const dedupeKey = eventDedupeKey(initialEvidence, payload);
    const created = await repository.createEvent({ dedupeKey, evidence: initialEvidence, payload });
    if (!created.created) {
      return {
        ok: true,
        duplicate: true,
        event_id: created.record.id,
        reconciliation_status: created.record.reconciliation_status,
        matched_csm_lead_id: created.record.matched_csm_lead_id || null
      };
    }

    const eventId = created.record.id;
    try {
      const priorIdentity = await repository.identityEvidence(initialEvidence.opusClientId, eventId);
      const stripeIdentity = initialEvidence.stripeCustomerId && repository.stripeIdentityEvidence
        ? await repository.stripeIdentityEvidence(initialEvidence.stripeCustomerId, eventId)
        : [];
      const evidence = mergeIdentity(initialEvidence, [...priorIdentity, ...stripeIdentity]);

      if (!evidence.verifiedPaidIntro) {
        const identityObserved = Boolean(evidence.parentEmailNorm || evidence.parentPhoneNorm);
        const status = identityObserved ? 'identity_observed' : 'ignored_unverified';
        const reason = identityObserved
          ? 'identity_saved_waiting_for_verified_paid_intro'
          : 'event_did_not_prove_paid_piano_intro';
        await repository.updateEvent(eventId, { evidence, status, reason });
        return { ok: true, event_id: eventId, reconciliation_status: status, reason };
      }

      const alreadyMatched = await repository.alreadyMatched(evidence);
      if (alreadyMatched) {
        await repository.updateEvent(eventId, {
          evidence,
          status: 'already_reconciled',
          reason: 'opus_booking_or_subscription_already_attached',
          matchMethod: alreadyMatched.reconciliation_match_method,
          leadId: alreadyMatched.csm_lead_id
        });
        return {
          ok: true,
          event_id: eventId,
          reconciliation_status: 'already_reconciled',
          matched_csm_lead_id: alreadyMatched.csm_lead_id
        };
      }

      const candidates = await repository.candidates(evidence.parentEmailNorm, evidence.parentPhoneNorm);
      const decision = chooseReconciliationMatch({
        evidence,
        ...candidates,
        eventAt: evidence.paidAt || now().toISOString()
      });

      if (decision.action === 'match') {
        const lead = await repository.markMatched(decision.lead.csm_lead_id, eventId, evidence, decision.method);
        await repository.updateEvent(eventId, {
          evidence,
          status: 'matched_paid',
          reason: 'verified_paid_opus_piano_intro',
          matchMethod: decision.method,
          leadId: lead.csm_lead_id
        });
        return {
          ok: true,
          event_id: eventId,
          reconciliation_status: 'matched_paid',
          match_method: decision.method,
          matched_csm_lead_id: lead.csm_lead_id
        };
      }

      if (decision.action === 'manual_review') {
        await repository.markManual(decision.candidateLeadIds || [], decision.reason);
        await repository.updateEvent(eventId, {
          evidence,
          status: 'manual_review',
          reason: decision.reason
        });
        return {
          ok: true,
          event_id: eventId,
          reconciliation_status: 'manual_review',
          reason: decision.reason,
          candidate_count: (decision.candidateLeadIds || []).length
        };
      }

      await repository.updateEvent(eventId, {
        evidence,
        status: 'verified_no_match',
        reason: decision.reason
      });
      return {
        ok: true,
        event_id: eventId,
        reconciliation_status: 'verified_no_match',
        reason: decision.reason
      };
    } catch (error) {
      await repository.updateEvent(eventId, {
        evidence: initialEvidence,
        status: 'processing_failed',
        reason: 'reconciliation_processing_failed',
        error: clean(error?.message || error, 2000)
      }).catch(() => {});
      throw error;
    }
  };
}

export const testables = {
  EVENT_TYPES,
  amountToCents,
  chooseReconciliationMatch,
  eventDedupeKey,
  extractOpusEvidence,
  extractStripeEvidence,
  flatten,
  mergeIdentity,
  normalizeEventType,
  sanityConflicts
};
