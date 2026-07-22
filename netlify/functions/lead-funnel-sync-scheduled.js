import { syncLeadFunnelToSheet } from './_shared/lead-pipeline.js';

export default async function leadFunnelSyncScheduled() {
  const result = await syncLeadFunnelToSheet();
  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = {
  schedule: '@hourly'
};
