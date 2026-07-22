import { drainOpusForwardQueue } from './_shared/lead-pipeline.js';

export default async function opusForwardRetryScheduled() {
  const results = await drainOpusForwardQueue(10);
  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = {
  schedule: '@hourly'
};
