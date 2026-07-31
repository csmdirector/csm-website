import crypto from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.PORT || 8080);
const SHEET_ID = process.env.SHEET_ID || '';
const SHEET_TAB = process.env.SHEET_TAB || 'Admin Candidates 2026';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const MAX_BODY_BYTES = 256 * 1024;
const EXPECTED_COLUMN_COUNT = 26;

let cachedToken = '';
let cachedTokenExpiresAt = 0;

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function secretsMatch(provided, expected) {
  const providedBuffer = Buffer.from(String(provided || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  return (
    providedBuffer.length === expectedBuffer.length &&
    providedBuffer.length > 0 &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function quoteSheetName(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function accessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;

  const response = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } }
  );
  const token = await response.json();
  if (!response.ok || !token.access_token) {
    throw new Error(`Metadata token failed: ${response.status}`);
  }

  cachedToken = token.access_token;
  cachedTokenExpiresAt = Date.now() + Number(token.expires_in || 300) * 1000;
  return cachedToken;
}

async function googleFetch(url, options = {}) {
  const token = await accessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  return response;
}

async function submissionExists(submissionId) {
  const range = `${quoteSheetName(SHEET_TAB)}!A2:A1000`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SHEET_ID)}` +
    `/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const response = await googleFetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Sheets lookup failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return (payload.values || []).some((row) => String(row?.[0] || '') === submissionId);
}

async function appendRow(row) {
  const range = `${quoteSheetName(SHEET_TAB)}!A:Z`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SHEET_ID)}` +
    `/values/${encodeURIComponent(range)}:append` +
    '?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE';
  const response = await googleFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ majorDimension: 'ROWS', values: [row] })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Sheets append failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload.updates?.updatedRange || '';
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { ok: true, service: 'csm-admin-candidate-sheet-webhook' });
    return;
  }
  if (req.method !== 'POST' || req.url !== '/') {
    json(res, 404, { ok: false, error: 'Not found.' });
    return;
  }
  if (!SHEET_ID || !WEBHOOK_SECRET) {
    json(res, 503, { ok: false, error: 'Service is not configured.' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    json(res, 400, { ok: false, error: 'Invalid JSON payload.' });
    return;
  }

  const providedSecret =
    req.headers['x-csm-webhook-secret'] ||
    payload.secret ||
    '';
  if (!secretsMatch(providedSecret, WEBHOOK_SECRET)) {
    json(res, 401, { ok: false, error: 'Unauthorized.' });
    return;
  }

  const row = Array.isArray(payload.row) ? payload.row : [];
  const submissionId = String(row[0] || '').trim();
  if (!submissionId || row.length !== EXPECTED_COLUMN_COUNT) {
    json(res, 422, {
      ok: false,
      error: `Expected a ${EXPECTED_COLUMN_COUNT}-column row with a submission ID.`
    });
    return;
  }

  if (await submissionExists(submissionId)) {
    console.log(`admin-candidate-sheet: duplicate ${submissionId}`);
    json(res, 200, { ok: true, duplicate: true });
    return;
  }

  const updatedRange = await appendRow(row);
  console.log(`admin-candidate-sheet: appended ${submissionId}`);
  json(res, 200, { ok: true, duplicate: false, updatedRange });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(`admin-candidate-sheet: ${error.message}`);
    json(res, 500, { ok: false, error: 'Internal error.' });
  });
});

server.listen(PORT, () => {
  console.log(`admin-candidate-sheet: listening on ${PORT}`);
});
