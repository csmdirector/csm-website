import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

let pool;

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

function isLeadPipelineEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(env('ENABLE_LEAD_PIPELINE')).trim().toLowerCase());
}

function disabledResult(scope) {
  console.log(`lead-pipeline: disabled; skipping ${scope}`);
  return { ok: true, skipped: true, disabled: true, reason: 'ENABLE_LEAD_PIPELINE is not true' };
}

function getPool() {
  const connectionString = env('DATABASE_URL') || env('POSTGRES_URL') || env('NETLIFY_DATABASE_URL');
  if (!connectionString) {
    throw new Error('DATABASE_URL or POSTGRES_URL is not configured.');
  }
  if (!pool) {
    const ssl = /sslmode=require|neon\.tech|supabase\./i.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined;
    pool = new Pool({ connectionString, ssl, max: 3 });
  }
  return pool;
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

function safeJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  const [rawLocal, rawDomain] = email.split('@');
  const domain = rawDomain === 'googlemail.com' ? 'gmail.com' : rawDomain;
  let local = rawLocal;
  if (domain === 'gmail.com') {
    local = local.split('+')[0].replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(value || '').trim().startsWith('+')) return `+${digits}`;
  return digits.length > 7 ? `+${digits}` : null;
}

function normalizeFields(source) {
  const fields = {};
  if (!source || typeof source !== 'object') return fields;
  Object.entries(source).forEach(([key, value]) => {
    if (!key) return;
    if (Array.isArray(value)) {
      fields[key] = value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ');
      return;
    }
    if (value && typeof value === 'object') {
      fields[key] = JSON.stringify(value);
      return;
    }
    fields[key] = String(value ?? '').trim();
  });
  return fields;
}

function valueFor(fields, keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    const value = fields && fields[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function minuteStamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 16);
  date.setSeconds(0, 0);
  return date.toISOString();
}

function normalizeEventType(value, source) {
  const raw = String(value || '').trim().toLowerCase();
  const compact = raw.replace(/[-\s]+/g, '_').replace(/_trigger$/g, '');
  if (/subscription.*create|create.*subscription/.test(compact)) return 'subscription_create';
  if (/subscription.*update|update.*subscription/.test(compact)) return 'subscription_update';
  if (/client.*create|customer.*create|member.*create|create.*client/.test(compact)) return 'client_create';
  if (/client.*update|customer.*update|member.*update|update.*client/.test(compact)) return 'client_update';
  if (/form.*submit|submit/.test(compact)) return 'form_submitted';
  if (source === 'lesson_fit') return 'form_submitted';
  return compact || 'unknown';
}

async function parseRequestBody(req) {
  const contentType = req.headers.get('content-type') || '';
  const rawText = await req.text();
  if (!rawText) return { contentType, rawText, parsed: {} };
  if (contentType.includes('application/json')) {
    try {
      return { contentType, rawText, parsed: JSON.parse(rawText) };
    } catch (error) {
      return { contentType, rawText, parsed: { raw_body: rawText, parse_error: error.message } };
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return {
      contentType,
      rawText,
      parsed: Object.fromEntries(new URLSearchParams(rawText).entries())
    };
  }
  return { contentType, rawText, parsed: { raw_body: rawText } };
}

function safeRequestHeaders(req) {
  const keep = [
    'content-type',
    'user-agent',
    'x-csm-source',
    'x-netlify-event',
    'x-opus-event',
    'x-opus-trigger',
    'x-forwarded-for'
  ];
  const headers = {};
  keep.forEach((key) => {
    const value = req.headers.get(key);
    if (value) headers[key] = value;
  });
  return headers;
}

function sourceTokenMap() {
  const map = {};
  const json = env('LEAD_EVENTS_SOURCE_TOKENS_JSON');
  if (json) {
    try {
      Object.assign(map, JSON.parse(json));
    } catch (error) {
      console.warn(`lead-events: invalid LEAD_EVENTS_SOURCE_TOKENS_JSON: ${error.message}`);
    }
  }
  const pairs = [
    ['lesson_fit', ['LEAD_EVENTS_LESSON_FIT_TOKEN', 'CSM_LESSON_FIT_TOKEN']],
    ['opus', ['LEAD_EVENTS_OPUS_TOKEN', 'OPUS_WEBHOOK_TOKEN', 'CSM_OPUS_SOURCE_TOKEN']]
  ];
  pairs.forEach(([source, names]) => {
    const token = names.map(env).find(Boolean);
    if (token) map[source] = token;
  });
  return map;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorizeSource(req) {
  const headerToken = req.headers.get('x-csm-source-token') || '';
  const auth = req.headers.get('authorization') || '';
  const bearerToken = auth.replace(/^Bearer\s+/i, '');
  const token = headerToken || bearerToken;
  const requestedSource = (req.headers.get('x-csm-source') || new URL(req.url).searchParams.get('source') || '').trim();
  const tokens = sourceTokenMap();

  for (const [source, expected] of Object.entries(tokens)) {
    if (token && expected && timingSafeEqual(token, expected)) {
      if (requestedSource && requestedSource !== source) continue;
      return { ok: true, source };
    }
  }

  return { ok: false };
}

function requireAdmin(req) {
  const expected = env('LEAD_PIPELINE_ADMIN_TOKEN');
  if (!expected) {
    return { ok: false, status: 500, message: 'LEAD_PIPELINE_ADMIN_TOKEN is not configured.' };
  }
  const token = req.headers.get('x-csm-admin-token') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !timingSafeEqual(token, expected)) {
    return { ok: false, status: 401, message: 'Unauthorized.' };
  }
  return { ok: true };
}

function inferOpusPayload(body) {
  return body?.payload || body?.data || body?.client || body?.subscription || body || {};
}

function eventTypeFromPayload(source, payload, headers = {}) {
  const body = payload?.body || payload || {};
  return normalizeEventType(
    body.event_type ||
      body.eventType ||
      body.event ||
      body.type ||
      body.trigger ||
      body.action ||
      headers['x-opus-event'] ||
      headers['x-opus-trigger'],
    source
  );
}

function externalIdFromPayload(source, eventType, payload) {
  const body = payload?.body || payload || {};
  if (source === 'lesson_fit') {
    const submission = body.payload || body.submission || body;
    return body.submission_id || submission.submission_id || submission.id || body.id || '';
  }
  const entity = inferOpusPayload(body);
  if (eventType.startsWith('subscription')) {
    return valueFor(entity, ['id', 'subscription_id', 'subscriptionId']) || valueFor(body, ['subscription_id', 'subscriptionId']);
  }
  return valueFor(entity, ['id', 'client_id', 'clientId', 'customer_id', 'member_id']) || valueFor(body, ['client_id', 'clientId']);
}

function extractLessonFitFields(payload) {
  const body = payload?.body || payload || {};
  const formPayload = body.payload || body.submission || body;
  return normalizeFields(payload?.data || formPayload.data || formPayload.values || body.data || formPayload);
}

function extractEmailForDedupe(source, payload) {
  if (source === 'lesson_fit') {
    const fields = extractLessonFitFields(payload);
    return normalizeEmail(valueFor(fields, ['email', 'parent_email', 'student_email']));
  }
  const body = payload?.body || payload || {};
  const entity = inferOpusPayload(body);
  return normalizeEmail(valueFor(entity, ['email', 'primary_email', 'email_address', 'student_email', 'parent1_email']));
}

function submittedAtForDedupe(payload) {
  const body = payload?.body || payload || {};
  const fields = extractLessonFitFields(payload);
  return (
    parseDate(fields.submitted_at) ||
    parseDate(body.created_at) ||
    parseDate(body.createdAt) ||
    parseDate(body.submitted_at) ||
    new Date().toISOString()
  );
}

function buildEventEnvelope({ source, payload, rawText = '', contentType = '', headers = {}, eventType, externalId, receivedFrom }) {
  const normalizedEventType = normalizeEventType(eventType || eventTypeFromPayload(source, payload, headers), source);
  const normalizedExternalId = externalId || externalIdFromPayload(source, normalizedEventType, payload);
  const emailNorm = extractEmailForDedupe(source, payload);
  const submittedAt = submittedAtForDedupe(payload);
  const fallback = rawText || JSON.stringify(payload || {});
  const dedupeBase = normalizedExternalId
    ? [source, normalizedEventType, normalizedExternalId].join('|')
    : [source, normalizedEventType, emailNorm || 'no-email', minuteStamp(submittedAt), sha256(fallback).slice(0, 12)].join('|');

  return {
    source,
    eventType: normalizedEventType,
    externalId: normalizedExternalId || null,
    dedupeKey: sha256(dedupeBase),
    payload: safeJson({
      received_from: receivedFrom || 'http',
      content_type: contentType || undefined,
      headers,
      body: payload,
      raw_body: rawText && typeof payload !== 'string' ? undefined : rawText
    })
  };
}

async function persistRawEvent(envelope) {
  const result = await getPool().query(
    `INSERT INTO events_raw (source, event_type, external_id, dedupe_key, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      envelope.source,
      envelope.eventType,
      envelope.externalId,
      envelope.dedupeKey,
      JSON.stringify(envelope.payload)
    ]
  );

  if (result.rows[0]) return { id: result.rows[0].id, isNew: true };

  const existing = await getPool().query('SELECT id FROM events_raw WHERE dedupe_key = $1', [envelope.dedupeKey]);
  return { id: existing.rows[0]?.id || null, isNew: false };
}

function parseTrackingSummary(summary) {
  const attribution = {};
  String(summary || '')
    .split('\n')
    .map((line) => line.trim())
    .forEach((line) => {
      const [label, ...rest] = line.split(':');
      const value = rest.join(':').trim();
      if (!value) return;
      const key = label.trim().toLowerCase();
      if (key === 'campaign') attribution.utm_campaign = value;
      if (key === 'content') attribution.utm_content = value;
      if (key === 'search term') attribution.utm_term = value;
      if (key === 'landing page') attribution.landing_path = value;
      if (key === 'referrer') attribution.referrer = value;
      if (key === 'click id') attribution.click_id = value;
      if (key === 'source') {
        const [source, medium] = value.split('/').map((part) => part.trim());
        if (source) attribution.utm_source = source;
        if (medium) attribution.utm_medium = medium;
      }
    });
  return attribution;
}

function compactObject(value) {
  const out = {};
  Object.entries(value || {}).forEach(([key, item]) => {
    if (item !== undefined && item !== null && String(item).trim() !== '') out[key] = item;
  });
  return out;
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) };
}

function buildStudentNote(fields, attribution, eventAt) {
  const campaign = [
    attribution.utm_source && attribution.utm_medium ? `${attribution.utm_source}/${attribution.utm_medium}` : '',
    attribution.utm_campaign ? `campaign=${attribution.utm_campaign}` : '',
    attribution.utm_term ? `term=${attribution.utm_term}` : '',
    attribution.gclid || attribution.gbraid || attribution.wbraid || attribution.click_id
      ? `click=${attribution.gclid || attribution.gbraid || attribution.wbraid || attribution.click_id}`
      : ''
  ].filter(Boolean).join(' · ');
  return [
    `Lesson Fit ${eventAt || new Date().toISOString()}`,
    campaign,
    valueFor(fields, 'lesson_request'),
    valueFor(fields, 'follow_up_notes'),
    valueFor(fields, 'student_context')
  ].filter(Boolean).join('\n\n');
}

function canonicalFromLessonFit(event) {
  const fields = extractLessonFitFields(event.payload);
  const displayName = valueFor(fields, ['parent_name', 'name', 'student_name']);
  const email = valueFor(fields, ['email', 'parent_email', 'student_email']);
  const phone = valueFor(fields, ['phone', 'primary_phone', 'student_phone']);
  const tracking = parseTrackingSummary(valueFor(fields, 'tracking_summary'));
  const attribution = compactObject({
    ...tracking,
    utm_source: valueFor(fields, 'utm_source') || tracking.utm_source,
    utm_medium: valueFor(fields, 'utm_medium') || tracking.utm_medium,
    utm_campaign: valueFor(fields, 'utm_campaign') || tracking.utm_campaign,
    utm_content: valueFor(fields, 'utm_content') || tracking.utm_content,
    utm_term: valueFor(fields, 'utm_term') || tracking.utm_term,
    gclid: valueFor(fields, 'gclid') || tracking.gclid,
    gbraid: valueFor(fields, 'gbraid') || tracking.gbraid,
    wbraid: valueFor(fields, 'wbraid') || tracking.wbraid,
    landing_path: valueFor(fields, 'landing_path') || tracking.landing_path,
    referrer: valueFor(fields, 'referrer') || tracking.referrer,
    routing_outcome: valueFor(fields, 'routing_outcome'),
    recommended_url: valueFor(fields, 'recommended_url')
  });
  const eventAt = parseDate(valueFor(fields, 'submitted_at')) || parseDate(event.payload?.created_at) || event.received_at;
  const context = valueFor(fields, ['student_context', 'follow_up_notes', 'lesson_request']);
  const { firstName, lastName } = splitName(displayName || 'Lesson Fit Lead');
  const studentAge = valueFor(fields, 'student_age');
  const isChild = studentAge && studentAge !== 'Adult';
  const note = buildStudentNote(fields, attribution, eventAt);
  const opusPayload = compactObject({
    source: 'lesson_fit',
    student_tags: ['lesson-fit'],
    student_note: note,
    instrument_interest: valueFor(fields, 'instrument_interest'),
    student_age: studentAge,
    preferred_location: valueFor(fields, 'preferred_location'),
    next_step_preference: valueFor(fields, 'next_step_preference'),
    help_reason: valueFor(fields, 'help_reason'),
    parent1_first_name: isChild ? firstName : undefined,
    parent1_last_name: isChild ? lastName : undefined,
    parent1_email: isChild ? email : undefined,
    parent1_phone: isChild ? phone : undefined,
    student_first_name: firstName,
    student_last_name: lastName,
    student_email: isChild ? undefined : email,
    student_phone: isChild ? undefined : phone
  });

  return {
    source: 'lesson_fit',
    eventType: 'form_submitted',
    eventAt,
    emailNorm: normalizeEmail(email),
    phoneNorm: normalizePhone(phone),
    displayName: displayName || null,
    firstSource: 'lesson_fit',
    firstUtm: attribution,
    firstContext: context || null,
    leadAt: eventAt,
    forwardToOpus: Boolean(email || phone),
    opusInboundPayload: opusPayload
  };
}

function opusEntity(body, eventType) {
  if (eventType.startsWith('subscription')) {
    return body.subscription || body.data?.subscription || body.payload?.subscription || body.data || body.payload || body;
  }
  return body.client || body.customer || body.member || body.data?.client || body.payload?.client || body.data || body.payload || body;
}

function canonicalFromOpus(event) {
  const body = event.payload?.body || {};
  const entity = opusEntity(body, event.event_type);
  const firstName = valueFor(entity, ['first_name', 'firstName', 'student_first_name', 'studentFirstName']);
  const lastName = valueFor(entity, ['last_name', 'lastName', 'student_last_name', 'studentLastName']);
  const displayName = valueFor(entity, ['name', 'display_name', 'displayName', 'full_name']) || [firstName, lastName].filter(Boolean).join(' ');
  const opusClientId =
    valueFor(entity, ['client_id', 'clientId', 'customer_id']) ||
    (event.event_type.startsWith('client') ? valueFor(entity, 'id') : '') ||
    valueFor(body, ['client_id', 'clientId']);
  const email = valueFor(entity, ['email', 'primary_email', 'email_address', 'student_email', 'parent1_email']);
  const phone = valueFor(entity, ['primary_phone', 'phone', 'phone_number', 'mobile_phone', 'student_phone', 'parent1_phone']);
  const createdAt =
    parseDate(valueFor(entity, ['created_at', 'createdAt', 'new_member_at', 'newMemberAt'])) ||
    parseDate(valueFor(body, ['created_at', 'createdAt'])) ||
    event.received_at;
  const subscriptionCreatedAt = event.event_type.startsWith('subscription')
    ? parseDate(valueFor(entity, ['created_at', 'createdAt', 'start_at', 'startAt'])) || createdAt
    : null;

  return {
    source: 'opus',
    eventType: event.event_type,
    eventAt: createdAt,
    emailNorm: normalizeEmail(email),
    phoneNorm: normalizePhone(phone),
    displayName: displayName || null,
    opusClientId: opusClientId || null,
    opusStatus: valueFor(entity, ['status', 'client_status', 'prospect_status']) || null,
    opusClientCreatedAt: event.event_type === 'client_create' ? createdAt : null,
    subscriptionCreatedAt
  };
}

function canonicalizeStoredEvent(event) {
  if (event.source === 'lesson_fit') return canonicalFromLessonFit(event);
  if (event.source === 'opus') return canonicalFromOpus(event);
  return {
    source: event.source,
    eventType: event.event_type,
    eventAt: event.received_at
  };
}

async function findPerson(client, canonical) {
  if (canonical.opusClientId) {
    const found = await client.query('SELECT id FROM people WHERE opus_client_id = $1', [canonical.opusClientId]);
    if (found.rows[0]) return found.rows[0].id;
  }
  if (canonical.emailNorm) {
    const found = await client.query('SELECT id FROM people WHERE email_norm = $1', [canonical.emailNorm]);
    if (found.rows[0]) return found.rows[0].id;
  }
  if (!canonical.emailNorm && canonical.phoneNorm) {
    const found = await client.query('SELECT id FROM people WHERE phone_norm = $1 ORDER BY created_at LIMIT 1', [canonical.phoneNorm]);
    if (found.rows[0]) return found.rows[0].id;
  }
  return null;
}

async function insertPerson(client, canonical) {
  await client.query('SAVEPOINT person_insert');
  try {
    const inserted = await client.query(
      `INSERT INTO people (
        email_norm, phone_norm, display_name, opus_client_id, opus_status,
        first_source, first_utm, first_context, lead_at,
        opus_client_created_at, subscription_created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, now())
      RETURNING id`,
      [
        canonical.emailNorm,
        canonical.phoneNorm,
        canonical.displayName,
        canonical.opusClientId,
        canonical.opusStatus,
        canonical.firstSource,
        canonical.firstUtm ? JSON.stringify(canonical.firstUtm) : null,
        canonical.firstContext,
        canonical.leadAt,
        canonical.opusClientCreatedAt,
        canonical.subscriptionCreatedAt
      ]
    );
    await client.query('RELEASE SAVEPOINT person_insert');
    return inserted.rows[0].id;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT person_insert');
    if (error.code !== '23505') throw error;
    const personId = await findPerson(client, canonical);
    await client.query('RELEASE SAVEPOINT person_insert');
    return personId;
  }
}

async function updatePerson(client, personId, canonical) {
  const updated = await client.query(
    `UPDATE people
     SET
       email_norm = COALESCE(people.email_norm, $2),
       phone_norm = COALESCE(people.phone_norm, $3),
       display_name = COALESCE(NULLIF(people.display_name, ''), $4),
       opus_client_id = COALESCE(people.opus_client_id, $5),
       opus_status = COALESCE($6, people.opus_status),
       first_source = COALESCE(people.first_source, $7),
       first_utm = COALESCE(people.first_utm, $8::jsonb),
       first_context = COALESCE(people.first_context, $9),
       lead_at = CASE
         WHEN people.lead_at IS NULL THEN $10
         WHEN $10::timestamptz IS NULL THEN people.lead_at
         ELSE LEAST(people.lead_at, $10::timestamptz)
       END,
       opus_client_created_at = CASE
         WHEN people.opus_client_created_at IS NULL THEN $11
         WHEN $11::timestamptz IS NULL THEN people.opus_client_created_at
         ELSE LEAST(people.opus_client_created_at, $11::timestamptz)
       END,
       subscription_created_at = CASE
         WHEN people.subscription_created_at IS NULL THEN $12
         WHEN $12::timestamptz IS NULL THEN people.subscription_created_at
         ELSE LEAST(people.subscription_created_at, $12::timestamptz)
       END,
       updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [
      personId,
      canonical.emailNorm,
      canonical.phoneNorm,
      canonical.displayName,
      canonical.opusClientId,
      canonical.opusStatus,
      canonical.firstSource,
      canonical.firstUtm ? JSON.stringify(canonical.firstUtm) : null,
      canonical.firstContext,
      canonical.leadAt,
      canonical.opusClientCreatedAt,
      canonical.subscriptionCreatedAt
    ]
  );
  return updated.rows[0]?.id || personId;
}

async function upsertPerson(client, canonical) {
  if (!canonical.opusClientId && !canonical.emailNorm && !canonical.phoneNorm) return null;
  const existingId = await findPerson(client, canonical);
  if (existingId) return updatePerson(client, existingId, canonical);
  return insertPerson(client, canonical);
}

async function enqueueOpusForward(client, eventId, personId, payload) {
  const queued = await client.query(
    `INSERT INTO opus_forward_queue (event_raw_id, person_id, payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (event_raw_id)
     DO UPDATE SET person_id = EXCLUDED.person_id, payload = EXCLUDED.payload, updated_at = now()
     RETURNING id`,
    [eventId, personId, JSON.stringify(payload)]
  );
  return queued.rows[0]?.id || null;
}

async function markEventError(eventId, error) {
  try {
    await getPool().query('UPDATE events_raw SET process_error = $2 WHERE id = $1', [eventId, String(error.message || error)]);
  } catch (updateError) {
    console.error(`lead-events: failed to mark event ${eventId} errored`, updateError);
  }
}

async function processStoredEvent(eventId) {
  if (!isLeadPipelineEnabled()) return disabledResult('stored event processing');

  const client = await getPool().connect();
  let forwardQueueId = null;
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM events_raw WHERE id = $1 FOR UPDATE', [eventId]);
    const event = found.rows[0];
    if (!event) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'missing_event' };
    }
    if (event.processed_at) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'already_processed' };
    }

    const canonical = canonicalizeStoredEvent(event);
    const personId = await upsertPerson(client, canonical);
    if (canonical.forwardToOpus && canonical.opusInboundPayload) {
      forwardQueueId = await enqueueOpusForward(client, eventId, personId, canonical.opusInboundPayload);
    }

    await client.query(
      'UPDATE events_raw SET person_id = $2, processed_at = now(), process_error = NULL WHERE id = $1',
      [eventId, personId]
    );
    await client.query('COMMIT');

    if (forwardQueueId) {
      try {
        await attemptOpusForward(forwardQueueId);
      } catch (error) {
        console.error(`lead-events: Opus forward queued for retry (${forwardQueueId}): ${error.message}`);
      }
    }
    return { eventId, personId, forwardQueueId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await markEventError(eventId, error);
    throw error;
  } finally {
    client.release();
  }
}

function retryDelayMinutes(attempts) {
  return [1, 10, 60, 360, 1440][Math.min(Math.max(attempts, 0), 4)];
}

async function attemptOpusForward(queueId) {
  if (!isLeadPipelineEnabled()) return disabledResult('Opus forward');

  const url = env('OPUS_INBOUND_WEBHOOK_URL');
  if (!url) {
    await getPool().query(
      `UPDATE opus_forward_queue
       SET status = 'blocked_config', last_error = 'OPUS_INBOUND_WEBHOOK_URL is not configured.', updated_at = now()
       WHERE id = $1`,
      [queueId]
    );
    return { ok: false, blocked: true };
  }

  const client = await getPool().connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    const found = await client.query('SELECT * FROM opus_forward_queue WHERE id = $1 FOR UPDATE', [queueId]);
    const item = found.rows[0];
    if (!item || item.status === 'completed') {
      await client.query('COMMIT');
      inTransaction = false;
      return { ok: true, skipped: true };
    }
    await client.query(
      `UPDATE opus_forward_queue
       SET attempts = attempts + 1, last_attempt_at = now(), status = 'sending', updated_at = now()
       WHERE id = $1`,
      [queueId]
    );
    await client.query('COMMIT');
    inTransaction = false;

    const headers = { 'Content-Type': 'application/json' };
    const token = env('OPUS_INBOUND_WEBHOOK_TOKEN');
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(item.payload)
    });
    const text = await response.text();
    const responsePayload = { body: text.slice(0, 5000) };

    if (!response.ok) {
      throw Object.assign(new Error(`Opus inbound webhook failed: ${response.status} ${text.slice(0, 500)}`), {
        status: response.status,
        responsePayload
      });
    }

    await getPool().query(
      `UPDATE opus_forward_queue
       SET status = 'completed', last_status = $2, opus_response = $3::jsonb, completed_at = now(), updated_at = now(), last_error = NULL
       WHERE id = $1`,
      [queueId, response.status, JSON.stringify(responsePayload)]
    );
    return { ok: true, status: response.status };
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    const current = await getPool().query('SELECT attempts FROM opus_forward_queue WHERE id = $1', [queueId]);
    const attempts = current.rows[0]?.attempts || 1;
    const terminal = attempts >= 5;
    await getPool().query(
      `UPDATE opus_forward_queue
       SET status = $2,
           last_status = $3,
           last_error = $4,
           next_attempt_at = now() + ($5 || ' minutes')::interval,
           updated_at = now()
       WHERE id = $1`,
      [
        queueId,
        terminal ? 'dead_letter' : 'retry',
        error.status || null,
        error.message,
        retryDelayMinutes(attempts)
      ]
    );
    throw error;
  } finally {
    client.release();
  }
}

async function drainOpusForwardQueue(limit = 10) {
  if (!isLeadPipelineEnabled()) return [disabledResult('Opus forward retry queue')];

  const due = await getPool().query(
    `SELECT id
     FROM opus_forward_queue
     WHERE status IN ('pending', 'retry')
       AND next_attempt_at <= now()
     ORDER BY next_attempt_at, id
     LIMIT $1`,
    [limit]
  );
  const results = [];
  for (const row of due.rows) {
    try {
      results.push(await attemptOpusForward(row.id));
    } catch (error) {
      results.push({ ok: false, id: row.id, error: error.message });
    }
  }
  return results;
}

async function handleRecentEventsRequest(req) {
  if (!isLeadPipelineEnabled()) return jsonResponse(disabledResult('recent event read'));

  const auth = requireAdmin(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.message }, auth.status);
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') || 20), 100);
  const rows = await getPool().query(
    `SELECT
       e.id, e.source, e.event_type, e.external_id, e.dedupe_key,
       e.received_at, e.processed_at, e.process_error, e.person_id,
       p.display_name, p.email_norm, p.phone_norm, p.opus_client_id,
       p.lead_at, p.opus_client_created_at, p.subscription_created_at,
       q.status AS opus_forward_status, q.last_status AS opus_forward_last_status, q.last_error AS opus_forward_last_error
     FROM events_raw e
     LEFT JOIN people p ON p.id = e.person_id
     LEFT JOIN opus_forward_queue q ON q.event_raw_id = e.id
     ORDER BY e.received_at DESC
     LIMIT $1`,
    [limit]
  );
  return jsonResponse({ ok: true, events: rows.rows });
}

async function handleLeadEventsRequest(req, context) {
  if (!isLeadPipelineEnabled()) return jsonResponse(disabledResult('lead event HTTP handler'));

  if (req.method === 'GET') return handleRecentEventsRequest(req);
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);

  const auth = authorizeSource(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: 'Unauthorized.' }, 401);

  try {
    const body = await parseRequestBody(req);
    const headers = safeRequestHeaders(req);
    const envelope = buildEventEnvelope({
      source: auth.source,
      payload: body.parsed,
      rawText: body.rawText,
      contentType: body.contentType,
      headers,
      receivedFrom: 'lead-events_http'
    });
    const stored = await persistRawEvent(envelope);

    if (stored.isNew && stored.id) {
      const work = processStoredEvent(stored.id).catch((error) => {
        console.error(`lead-events: processing failed for event ${stored.id}`, error);
      });
      if (context && typeof context.waitUntil === 'function') context.waitUntil(work);
      else await work;
    }

    return jsonResponse({ ok: true, event_id: stored.id, duplicate: !stored.isNew });
  } catch (error) {
    console.error('lead-events: raw persist failed', error);
    return jsonResponse({ ok: false, error: error.message }, 500);
  }
}

function parseEventBody(event) {
  if (typeof event?.body === 'string') {
    try {
      return JSON.parse(event.body);
    } catch (error) {
      return {};
    }
  }
  return {};
}

function getSubmissionContainer(event) {
  const parsedBody = parseEventBody(event);
  return event?.payload || parsedBody.payload || event?.submission || parsedBody || event || {};
}

function extractNetlifyFormSubmission(event) {
  const c = getSubmissionContainer(event);
  const data = c.data || c.values || event?.data || {};
  return {
    formName: data['form-name'] || data.form_name || c.form_name || c.formName || c.name || '',
    data: normalizeFields(data),
    id: c.id || c.submission_id || event?.id || '',
    createdAt: c.created_at || c.createdAt || event?.created_at || event?.createdAt || new Date().toISOString()
  };
}

async function captureNetlifyLessonFitSubmission(event) {
  if (!isLeadPipelineEnabled()) return disabledResult('Lesson Fit form capture');

  const submission = extractNetlifyFormSubmission(event || {});
  if (submission.formName !== 'lesson-fit-request') {
    return { skipped: true, reason: 'not_lesson_fit' };
  }
  if (valueFor(submission.data, 'bot-field')) {
    return { skipped: true, reason: 'honeypot' };
  }

  const envelope = buildEventEnvelope({
    source: 'lesson_fit',
    eventType: 'form_submitted',
    externalId: submission.id,
    payload: {
      provider: 'netlify_forms',
      form_name: submission.formName,
      submission_id: submission.id,
      created_at: submission.createdAt,
      data: submission.data
    },
    receivedFrom: 'netlify_form_submitted'
  });
  const stored = await persistRawEvent(envelope);
  if (stored.isNew && stored.id) {
    await processStoredEvent(stored.id);
  }
  return stored;
}

function quoteSheetName(sheetName) {
  return `'${String(sheetName || 'lead_funnel').replace(/'/g, "''")}'`;
}

function base64url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function googleAccessToken() {
  const clientEmail = env('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const privateKey = env('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY are required for Sheet sync.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer.sign(privateKey, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Google auth failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function ensureSheetTab(spreadsheetId, sheetName, token) {
  const meta = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const json = await meta.json();
  if (!meta.ok) throw new Error(`Google Sheets metadata failed: ${meta.status} ${JSON.stringify(json)}`);
  if ((json.sheets || []).some((sheet) => sheet.properties?.title === sheetName)) return;

  const added = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] })
  });
  const addedJson = await added.json();
  if (!added.ok) throw new Error(`Google Sheets add tab failed: ${added.status} ${JSON.stringify(addedJson)}`);
}

async function syncLeadFunnelToSheet() {
  if (!isLeadPipelineEnabled()) return disabledResult('lead funnel Sheet sync');

  const spreadsheetId = env('LEAD_FUNNEL_SHEET_ID');
  const sheetName = env('LEAD_FUNNEL_SHEET_TAB') || 'lead_funnel';
  if (!spreadsheetId) throw new Error('LEAD_FUNNEL_SHEET_ID is not configured.');

  const result = await getPool().query(
    `SELECT
       person_id, display_name, email_norm, phone_norm, first_source,
       utm_source, utm_medium, utm_campaign, lead_at, opus_client_created_at,
       subscription_created_at, days_to_enroll, current_opus_status, user_context, opus_client_id
     FROM lead_funnel
     ORDER BY lead_at DESC NULLS LAST, person_id DESC`
  );
  const headers = [
    'person_id',
    'display_name',
    'email',
    'phone',
    'first_source',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'lead_at',
    'opus_client_created_at',
    'subscription_created_at',
    'days_to_enroll',
    'current_opus_status',
    'user_context',
    'opus_client_id'
  ];
  const values = [
    headers,
    ...result.rows.map((row) => [
      row.person_id,
      row.display_name,
      row.email_norm,
      row.phone_norm,
      row.first_source,
      row.utm_source,
      row.utm_medium,
      row.utm_campaign,
      row.lead_at ? new Date(row.lead_at).toISOString() : '',
      row.opus_client_created_at ? new Date(row.opus_client_created_at).toISOString() : '',
      row.subscription_created_at ? new Date(row.subscription_created_at).toISOString() : '',
      row.days_to_enroll ?? '',
      row.current_opus_status,
      row.user_context,
      row.opus_client_id
    ])
  ];

  const token = await googleAccessToken();
  await ensureSheetTab(spreadsheetId, sheetName, token);
  const quoted = quoteSheetName(sheetName);
  const range = `${quoted}!A1:O`;
  const clear = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}'
    }
  );
  if (!clear.ok) throw new Error(`Google Sheets clear failed: ${clear.status} ${await clear.text()}`);

  const update = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${quoted}!A1`)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range: `${quoted}!A1`, majorDimension: 'ROWS', values })
    }
  );
  if (!update.ok) throw new Error(`Google Sheets update failed: ${update.status} ${await update.text()}`);
  return { spreadsheetId, sheetName, rows: result.rows.length };
}

async function handleLeadFunnelSyncRequest(req) {
  if (!isLeadPipelineEnabled()) return jsonResponse(disabledResult('lead funnel sync endpoint'));

  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  const auth = requireAdmin(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.message }, auth.status);
  const result = await syncLeadFunnelToSheet();
  return jsonResponse({ ok: true, ...result });
}

export {
  captureNetlifyLessonFitSubmission,
  drainOpusForwardQueue,
  handleLeadEventsRequest,
  handleLeadFunnelSyncRequest,
  processStoredEvent,
  syncLeadFunnelToSheet
};

export const testables = {
  buildEventEnvelope,
  canonicalizeStoredEvent,
  extractNetlifyFormSubmission,
  isLeadPipelineEnabled,
  normalizeEmail,
  normalizeEventType,
  normalizeFields,
  normalizePhone,
  parseRequestBody,
  parseTrackingSummary
};
