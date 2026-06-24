const INFO_EMAIL = 'info@cincinnatischoolofmusic.com';
const DIRECTOR_EMAIL = 'director@cincinnatischoolofmusic.com';
const DEFAULT_FROM = 'CSM Website <forms@cincinnatischoolofmusic.com>';

const ROUTES = {
  'promo-claim': {
    to: INFO_EMAIL,
    label: 'Promo Claim',
    subject: 'New promo claim',
    replyTo: ['email'],
    groups: [
      ['Promo', ['promo_name', 'promo_deadline', 'promo_summary']],
      ['Parent', ['parent_guardian_name', 'phone', 'email', 'family_contact_summary']],
      ['Student', ['student_name', 'student_age', 'interested_lesson', 'preferred_location', 'student_lesson_summary']],
      ['Schedule and notes', ['best_days_times', 'notes_questions', 'schedule_notes_summary']],
      ['Attribution', ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'landing_path', 'submitted_at', 'attribution_summary']]
    ]
  },
  'lesson-fit-request': {
    to: INFO_EMAIL,
    label: 'Lesson Fit Request',
    subject: 'New Lesson Fit help request',
    replyTo: ['email'],
    groups: [
      ['Contact', ['parent_name', 'email', 'phone', 'contact_summary']],
      ['Lesson request', ['instrument_interest', 'student_age', 'preferred_location', 'next_step_preference', 'lesson_request']],
      ['Follow-up notes', ['help_reason', 'student_context', 'follow_up_notes']],
      ['Tracking', ['tracking_summary']]
    ]
  },
  'smart-intro-intake': {
    to: INFO_EMAIL,
    label: 'Smart Intro Intake',
    subject: 'New Smart Intro intake',
    replyTo: ['email'],
    groups: [
      ['Contact', ['parent_name', 'name', 'email', 'phone']],
      ['Lesson request', ['instrument_interest', 'instrument', 'student_age', 'preferred_location', 'location', 'next_step_preference']],
      ['Notes', ['help_reason', 'student_context', 'notes', 'message']],
      ['Tracking', ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'gbraid', 'wbraid', 'landing_path']]
    ]
  },
  withdraw: {
    to: INFO_EMAIL,
    label: 'Withdrawal Form',
    subject: 'New withdrawal form submission',
    replyTo: ['email'],
    groups: [
      ['Student', ['student_first_name', 'student_last_name', 'instrument', 'teacher']],
      ['Parent and contact', ['parent_name', 'primary_phone', 'email', 'street_address', 'city', 'state', 'zip']],
      ['Withdrawal details', ['last_lesson_date', 'reason_for_withdrawing', 'selected_action']],
      ['Feedback', ['experience_feedback']]
    ]
  },
  'teacher-makeup-day-request': {
    to: INFO_EMAIL,
    label: 'Teacher Makeup Day Request',
    subject: 'New teacher makeup day request',
    replyTo: ['teacher-email'],
    groups: [
      ['Teacher', ['teacher-name', 'teacher-email', 'instruments']],
      ['Request', ['proposed-date', 'location', 'time-block', 'used-this-year', 'earlier-date']],
      ['Acknowledgements', ['ack-not-guaranteed', 'ack-within-14', 'ack-not-tied-to-absence', 'ack-not-30-day-closure', 'ack-not-2-already', 'ack-no-family-contact']]
    ]
  },
  'instrument-maintenance': {
    to: DIRECTOR_EMAIL,
    label: 'Instrument Maintenance Request',
    subject: 'New instrument maintenance request',
    replyTo: ['sender_email'],
    groups: [
      ['Location', ['location', 'studio_number']],
      ['Instrument', ['instrument_type']],
      ['Issue', ['issue_description', 'other_issues']],
      ['Submitted by', ['submitted_by', 'sender_email']]
    ]
  },
  'admin-application': {
    to: DIRECTOR_EMAIL,
    label: 'Admin Application',
    subject: 'New admin application',
    replyTo: ['email'],
    groups: [
      ['Applicant', ['first-name', 'last-name', 'email', 'phone', 'city']],
      ['Position', ['position', 'anticipated-tenure']],
      ['Written responses', ['why-interested', 'skills-experience']],
      ['Additional steps', ['resume-sent', 'voicemail-left', 'additional-notes']]
    ]
  }
};

const SKIP_FIELDS = new Set(['bot-field', 'form-name', 'subject']);

function env(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env && typeof Netlify.env.get === 'function') {
    return Netlify.env.get(name);
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  return '';
}

function normalizeFields(source) {
  const fields = {};
  if (!source || typeof source !== 'object') return fields;

  Object.entries(source).forEach(([key, value]) => {
    if (!key) return;
    if (Array.isArray(value)) {
      fields[key] = value.map(formatValue).filter(Boolean);
      return;
    }
    fields[key] = formatValue(value);
  });

  return fields;
}

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function valueFor(fields, key) {
  const value = fields[key];
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return value || '';
}

function getFormName(event, fields) {
  const submission = event && event.submission ? event.submission : {};
  return (
    valueFor(fields, 'form-name') ||
    valueFor(fields, 'form_name') ||
    submission.formName ||
    submission.form_name ||
    event.formName ||
    event.form_name ||
    ''
  );
}

function getReplyTo(fields, keys) {
  const email = keys.map((key) => valueFor(fields, key)).find(isEmailLike);
  return email || undefined;
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
}

function labelFor(key) {
  return key
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSections(route, fields) {
  const used = new Set(SKIP_FIELDS);
  const sections = [];

  route.groups.forEach(([heading, keys]) => {
    const rows = keys
      .map((key) => {
        used.add(key);
        return [labelFor(key), valueFor(fields, key)];
      })
      .filter(([, value]) => value);

    if (rows.length) sections.push([heading, rows]);
  });

  const otherRows = Object.keys(fields)
    .filter((key) => !used.has(key) && valueFor(fields, key))
    .sort()
    .map((key) => [labelFor(key), valueFor(fields, key)]);

  if (otherRows.length) sections.push(['Other fields', otherRows]);
  return sections;
}

function buildText(route, formName, fields, meta) {
  const lines = [
    route.label,
    `Form: ${formName}`,
    `Routed to: ${route.to}`,
    `Submission ID: ${meta.id || 'Not provided'}`,
    `Submitted at: ${meta.createdAt || valueFor(fields, 'submitted_at') || new Date().toISOString()}`,
    ''
  ];

  buildSections(route, fields).forEach(([heading, rows]) => {
    lines.push(`${heading}:`);
    rows.forEach(([label, value]) => lines.push(`${label}: ${value}`));
    lines.push('');
  });

  return lines.join('\n').trim();
}

function buildHtml(route, formName, fields, meta) {
  const sections = buildSections(route, fields)
    .map(([heading, rows]) => {
      const body = rows
        .map(([label, value]) => `
          <tr>
            <th align="left" style="padding:8px 12px;border-bottom:1px solid #e6e4e1;width:220px;vertical-align:top;color:#3d3d3d;">${escapeHtml(label)}</th>
            <td style="padding:8px 12px;border-bottom:1px solid #e6e4e1;white-space:pre-wrap;color:#3d3d3d;">${escapeHtml(value)}</td>
          </tr>
        `)
        .join('');

      return `
        <h2 style="font-size:16px;margin:28px 0 8px;color:#3d3d3d;">${escapeHtml(heading)}</h2>
        <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;border-top:1px solid #e6e4e1;">${body}</table>
      `;
    })
    .join('');

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#3d3d3d;max-width:760px;">
      <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#747474;margin:0 0 6px;">Cincinnati School of Music</p>
      <h1 style="font-size:22px;margin:0 0 18px;color:#3d3d3d;">${escapeHtml(route.label)}</h1>
      <p style="margin:0 0 4px;"><strong>Form:</strong> ${escapeHtml(formName)}</p>
      <p style="margin:0 0 4px;"><strong>Routed to:</strong> ${escapeHtml(route.to)}</p>
      <p style="margin:0 0 4px;"><strong>Submission ID:</strong> ${escapeHtml(meta.id || 'Not provided')}</p>
      <p style="margin:0 0 20px;"><strong>Submitted at:</strong> ${escapeHtml(meta.createdAt || valueFor(fields, 'submitted_at') || new Date().toISOString())}</p>
      ${sections}
    </div>
  `;
}

function getSubmission(event) {
  const submission = event && event.submission ? event.submission : {};
  const data = submission.data || submission.values || event.data || {};
  return {
    data: normalizeFields(data),
    id: submission.id || event.id || '',
    createdAt: submission.created_at || submission.createdAt || event.created_at || event.createdAt || ''
  };
}

async function sendEmail(route, formName, fields, meta) {
  const apiKey = env('RESEND_API_KEY');
  const from = env('FORM_EMAIL_FROM') || env('RESEND_FROM') || DEFAULT_FROM;

  if (!apiKey) {
    console.error(`Skipping ${formName} email: RESEND_API_KEY is not configured.`);
    return;
  }

  const replyTo = getReplyTo(fields, route.replyTo || []);
  const subject = valueFor(fields, 'subject') || route.subject;
  const body = {
    from,
    to: [route.to],
    subject,
    text: buildText(route, formName, fields, meta),
    html: buildHtml(route, formName, fields, meta),
    tags: [{ name: 'form', value: formName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256) }]
  };

  if (replyTo) body.reply_to = replyTo;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  if (meta.id) {
    headers['Idempotency-Key'] = `csm-${formName}-${meta.id}`.slice(0, 256);
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend failed for ${formName}: ${response.status} ${details}`);
  }
}

export default {
  async formSubmitted(event) {
    const submission = getSubmission(event || {});
    const formName = getFormName(event || {}, submission.data);
    const route = ROUTES[formName];

    if (!route) return;
    if (valueFor(submission.data, 'bot-field')) return;

    await sendEmail(route, formName, submission.data, {
      id: submission.id,
      createdAt: submission.createdAt
    });
  }
};

export const testables = {
  ROUTES,
  buildText,
  buildHtml,
  getFormName,
  getSubmission,
  normalizeFields
};
