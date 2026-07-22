import { handleLeadEventsRequest } from './_shared/lead-pipeline.js';

export default async function leadEvents(req, context) {
  return handleLeadEventsRequest(req, context);
}

export const config = {
  path: '/api/lead-events'
};
