// A local-only durable repository double. External providers are injected by tests.
export function requestInfoRepository(initial) {
  let row = initial ? structuredClone(initial) : null;
  const copy = () => row && structuredClone(row);
  return {
    get row() { return copy(); },
    async createLead(input) {
      if (row?.client_submission_id === input.clientSubmissionId) return { record: copy(), replay: true, created: false };
      row = Object.fromEntries(Object.entries(input).map(([key, value]) => [key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase()), value]));
      row.csm_lead_id = input.leadId;
      row.office_notification_status = 'pending';
      row.office_notification_payload = {};
      row.opus_post_status = 'not_attempted_vanilla_handoff';
      return { record: copy(), replay: false, created: true };
    },
    async getLead(id, clientId) {
      return row?.csm_lead_id === id && row?.client_submission_id === clientId ? copy() : null;
    },
    async recordHandoffChoice(id, clientId, choice) {
      if (!await this.getLead(id, clientId)) return { record: null };
      if (row.existing_family && choice === 'online_booking') return { record: copy(), blockedExistingFamily: true };
      const changed = row.handoff_choice !== choice;
      row.handoff_choice = choice;
      row.office_follow_up_required = choice === 'office_help' || Boolean(row.office_follow_up_required);
      return { record: copy(), changed, replay: !changed };
    },
    async claimOfficeNotification(id, payload) {
      const confirmed = row.office_notification_status === 'sent' && (
        row.office_notification_payload?._request_info_version === payload._request_info_version ||
        row.office_notification_payload?.['form-name'] === 'intro-bridge-office-help');
      if (row.office_notification_status === 'sending' || confirmed) return null;
      row.office_notification_status = 'sending';
      if (row.office_notification_payload?._request_info_version !== payload._request_info_version) {
        row.office_notification_payload = structuredClone(payload);
      }
      return copy();
    },
    async recordOfficeNotification(id, payload, result) {
      row.office_notification_status = result.status;
      row.office_notification_payload = structuredClone(payload);
      return copy();
    },
    async claimOpusRequestInfo(record, payload) {
      if (row.opus_attempted_at || row.opus_post_status?.startsWith('office_help_')) return { claimed: false, record: copy() };
      row.opus_post_status = 'office_help_sending';
      row.opus_attempted_at = new Date().toISOString();
      row.opus_payload = structuredClone(payload);
      return { claimed: true, record: copy() };
    },
    async recordOpusRequestInfo(id, result) {
      row.opus_post_status = result.status;
      row.opus_http_status = result.httpStatus;
      row.opus_response_body = result.responseBody;
      row.opus_error = result.error;
      return copy();
    }
  };
}
