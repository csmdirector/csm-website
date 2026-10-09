// Stored with the existing durable inquiry note; no production schema migration.
// Only a server-generated first line is parsed. Free-text answers cannot override it.
const PREFIX = 'CSM inquiry policy v1: ';
export const CONTACT_CHANNELS = ['standard', 'email', 'text', 'phone'];
export const REQUEST_INTENTS = ['question', 'booking_help'];
export function normalizeInquiryPolicy(fields = {}) {
  return {
    intent: REQUEST_INTENTS.includes(fields.request_intent) ? fields.request_intent : 'booking_help',
    channel: CONTACT_CHANNELS.includes(fields.contact_preference) ? fields.contact_preference : 'standard'
  };
}
export function storeInquiryPolicy(fields, note) {
  return PREFIX + JSON.stringify(normalizeInquiryPolicy(fields)) + '\n' + note;
}
export function readInquiryPolicy(record) {
  const first = String(record.student_note || '').split('\n')[0];
  if (first.startsWith(PREFIX)) {
    try { const policy = JSON.parse(first.slice(PREFIX.length)); return normalizeInquiryPolicy({request_intent:policy.intent,contact_preference:policy.channel}); } catch {}
  }
  // Legacy genuine inquiries follow CSM’s established outreach workflow.
  // Explicit preferences recorded during the earlier form remain binding.
  return normalizeInquiryPolicy();
}
export function visibleInquiryNote(record) {
  const note = String(record.student_note || '');
  return note.startsWith(PREFIX) ? note.slice(note.indexOf('\n') + 1) : note;
}
export function inquiryInstructions(record) {
  const {intent, channel} = readInquiryPolicy(record);
  const kind = intent === 'question' ? 'Question' : 'Booking help';
  const reply = {standard:'Office follow-up requested',email:'Email reply requested',text:'Text reply requested',phone:'Phone call requested'}[channel];
  const action = {
    standard: 'Follow up by email, phone, or text using CSM’s established inquiry process. Address the customer’s question or scheduling request before generic follow-up. Honor any specific contact restrictions or opt-out in the message or existing account.',
    email: 'Reply by email only. Do not call, text, or add this inquiry to an automated prospect sequence.',
    text: 'Text the customer about this request. Do not call or add this inquiry to an automated prospect sequence.',
    phone: 'Call the customer about this request. Do not add this inquiry to an automated prospect sequence.'
  }[channel];
  return {request_intent:intent,contact_preference:channel,subject:kind + ' | ' + reply,inquiry_heading:kind + ': ' + reply,office_action:action};
}
