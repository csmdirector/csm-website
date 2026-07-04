import { handleLeadFunnelSyncRequest } from './_shared/lead-pipeline.js';

export default async function leadFunnelSync(req) {
  return handleLeadFunnelSyncRequest(req);
}

export const config = {
  path: '/api/lead-funnel-sync'
};
