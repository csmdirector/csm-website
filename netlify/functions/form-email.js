const INFO_EMAIL = 'info@cincinnatischoolofmusic.com';
const DIRECTOR_EMAIL = 'director@cincinnatischoolofmusic.com';

const ROUTES = {
  'promo-claim': {
    to: INFO_EMAIL,
    label: 'Promo Claim',
    subject: 'New promo claim',
    replyTo: ['email'],
    groups: [
      ['Promo', ['promo_name', 'promo_deadline']],
      ['Parent', ['parent_guardian_name', 'phone', 'email']],
      ['Student', ['student_name', 'student_age', 'interested_lesson', 'preferred_location']],
      ['Schedule and notes', ['best_days_times', 'notes_questions']],
      ['Attribution', ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'landing_path']]
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

const SKIP_FIELDS = new Set(['bot-field', 'form-name', 'subject', 'submitted_at']);
const FIELD_LABELS = {
  'ack-no-family-contact': 'Office confirmation',
  'ack-not-2-already': 'Two-day limit',
  'ack-not-30-day-closure': 'Closure window',
  'ack-not-guaranteed': 'Approval acknowledgement',
  'ack-not-tied-to-absence': 'Not tied to absence',
  'ack-within-14': 'Within 14 days',
  'additional-notes': 'Additional notes',
  'anticipated-tenure': 'Anticipated tenure',
  best_days_times: 'Best days/times',
  email: 'Email',
  experience_feedback: 'Experience feedback',
  fbclid: 'Facebook click ID',
  'first-name': 'First name',
  help_reason: 'Help reason',
  instrument_type: 'Instrument type',
  interested_lesson: 'Interested lesson/instrument',
  issue_description: 'Issue description',
  landing_path: 'Landing path',
  'last-name': 'Last name',
  last_lesson_date: 'Last lesson date',
  location: 'Location',
  next_step_preference: 'Next step preference',
  notes_questions: 'Notes/questions',
  other_issues: 'Other issues',
  parent_guardian_name: 'Parent/guardian name',
  parent_name: 'Parent/guardian name',
  phone: 'Phone',
  preferred_location: 'Preferred location',
  primary_phone: 'Primary phone',
  promo_deadline: 'Promo deadline',
  promo_name: 'Promo name',
  proposed_date: 'Proposed date',
  'proposed-date': 'Proposed date',
  reason_for_withdrawing: 'Reason for withdrawing',
  'resume-sent': 'Resume sent',
  selected_action: 'Selected action',
  sender_email: 'Sender email',
  skills_experience: 'Skills/experience',
  'skills-experience': 'Skills/experience',
  student_age: 'Student age',
  student_context: 'Student context',
  student_first_name: 'Student first name',
  student_last_name: 'Student last name',
  student_name: 'Student name',
  studio_number: 'Studio number',
  submitted_by: 'Submitted by',
  'teacher-email': 'Teacher email',
  'teacher-name': 'Teacher name',
  'time-block': 'Time block',
  used_this_year: 'Used this year',
  'used-this-year': 'Used this year',
  utm_campaign: 'UTM campaign',
  utm_content: 'UTM content',
  utm_medium: 'UTM medium',
  utm_source: 'UTM source',
  utm_term: 'UTM term',
  'voicemail-left': 'Voicemail left',
  why_interested: 'Why interested',
  'why-interested': 'Why interested'
};

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

function getSubmissionContainer(event) {
  if (!event || typeof event !== 'object') return {};
  let parsedBody = null;
  if (typeof event.body === 'string') {
    try {
      parsedBody = JSON.parse(event.body);
    } catch (err) {
      parsedBody = null;
    }
  }
  return (
    event.payload ||
    (parsedBody && parsedBody.payload) ||
    parsedBody ||
    event.submission ||
    event
  );
}

function getFormName(event, fields) {
  const c = getSubmissionContainer(event);
  return (
    valueFor(fields, 'form-name') ||
    valueFor(fields, 'form_name') ||
    c.form_name ||
    c.formName ||
    c.name ||
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
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
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

function prettyDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  try {
    return (
      date.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }) + ' ET'
    );
  } catch (err) {
    return date.toISOString();
  }
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
  const submittedAt = meta.createdAt || valueFor(fields, 'submitted_at') || new Date().toISOString();
  const replyTo = getReplyTo(fields, route.replyTo || []);
  const sections = buildSections(route, fields)
    .map(([heading, rows]) => {
      const body = rows
        .map(([label, value], index) => `
          <tr>
            <td style="padding:9px 0;${index ? 'border-top:1px solid #efede9;' : ''}vertical-align:top;width:170px;color:#8a8a86;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;line-height:1.5;">${escapeHtml(label)}</td>
            <td style="padding:9px 0 9px 18px;${index ? 'border-top:1px solid #efede9;' : ''}vertical-align:top;white-space:pre-wrap;color:#1e1e1e;font-size:14px;line-height:1.55;">${escapeHtml(value)}</td>
          </tr>
        `)
        .join('');

      return `
        <tr>
          <td style="padding:22px 32px 0;">
            <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#f74f57;margin:0 0 4px;">${escapeHtml(heading)}</div>
            <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">${body}</table>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <div style="margin:0;padding:0;background:#f0efee;">
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:#f0efee;">
        <tr>
          <td style="padding:28px 12px;">
            <table role="presentation" align="center" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;margin:0 auto;border-collapse:collapse;background:#ffffff;border:1px solid #e6e4e1;border-radius:10px;overflow:hidden;font-family:'Helvetica Neue',Arial,sans-serif;color:#1e1e1e;">
              <tr><td style="height:4px;background:#f74f57;font-size:0;line-height:0;">&nbsp;</td></tr>
              <tr>
                <td style="padding:26px 32px 24px;background:#1e1e1e;">
                  <div style="font-size:11px;line-height:1.3;letter-spacing:.18em;text-transform:uppercase;color:#f74f57;font-weight:700;margin-bottom:10px;">Cincinnati School of Music</div>
                  <div style="font-size:22px;line-height:1.25;font-weight:700;color:#ffffff;">${escapeHtml(route.label)}</div>
                  <div style="font-size:12px;line-height:1.5;color:#b8b7b4;margin-top:10px;">Form: ${escapeHtml(formName)} &nbsp;&bull;&nbsp; Routed to ${escapeHtml(route.to)}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 32px 2px;">
                  <div style="font-size:12px;line-height:1.6;color:#8a8a86;"><strong style="color:#5f5e5a;">Submitted</strong> ${escapeHtml(prettyDate(submittedAt))}${replyTo ? ` &nbsp;&bull;&nbsp; <strong style="color:#5f5e5a;">Reply-to</strong> <a href="mailto:${escapeHtml(replyTo)}" style="color:#185fa5;text-decoration:none;">${escapeHtml(replyTo)}</a>` : ''}</div>
                </td>
              </tr>
              ${sections}
              <tr>
                <td style="padding:24px 32px 28px;">
                  <div style="border-top:1px solid #efede9;padding-top:14px;font-size:11px;line-height:1.5;color:#a3a29e;">Standardized CSM form email. Netlify form storage and approved webhooks remain active.${meta.id ? ` &nbsp;&bull;&nbsp; ID ${escapeHtml(meta.id)}` : ''}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function getSubmission(event) {
  const c = getSubmissionContainer(event);
  const data = c.data || c.values || (event && event.data) || {};
  return {
    data: normalizeFields(data),
    id: c.id || c.submission_id || (event && event.id) || '',
    createdAt: c.created_at || c.createdAt || (event && event.created_at) || (event && event.createdAt) || ''
  };
}

async function sendEmail(route, formName, fields, meta) {
  const apiKey = env('RESEND_API_KEY');
  const from = env('FORM_EMAIL_FROM') || env('RESEND_FROM') || `CSM Website <${route.to}>`;

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

  const details = await response.text();
  if (!response.ok) {
    throw new Error(`Resend failed for ${formName}: ${response.status} ${details}`);
  }
  console.log(`form-email: sent ${formName} -> ${route.to} (${response.status}) ${details}`);
}

export default {
  async formSubmitted(event) {
    const submission = getSubmission(event || {});
    const formName = getFormName(event || {}, submission.data);
    const route = ROUTES[formName];

    console.log(
      `form-email: received form="${formName}" fieldCount=${Object.keys(submission.data || {}).length} routed=${route ? route.to : 'NONE'}`
    );

    if (!route) {
      console.warn(`form-email: no route for "${formName}"; event keys=[${Object.keys(event || {}).join(', ')}]`);
      return;
    }
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
