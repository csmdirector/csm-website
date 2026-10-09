// Stored with the existing durable inquiry note; no production schema migration.
// Only a server-generated first line is parsed. Free-text answers cannot override it.
const PREFIX = 'CSM inquiry policy v1: ';
export const CONTACT_CHANNELS = ['email', 'text', 'phone'];
export const REQUEST_INTENTS = ['question', 'booking_help'];
export function normalizeInquiryPolicy(fields = {}) {
  return {
    intent: REQUEST_INTENTS.includes(fields.request_intent) ? fields.request_intent : 'booking_help',
    channel: CONTACT_CHANNELS.includes(fields.contact_preference) ? fields.contact_preference : 'email'
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
  // Legacy help requests have no selected channel. Start with an email reply;
  // a collected phone number alone is not a request for calls or texts.
  return normalizeInquiryPolicy();
}
export function visibleInquiryNote(record) {
  const note = String(record.student_note || '');
  return note.startsWith(PREFIX) ? note.slice(note.indexOf('\n') + 1) : note;
}
export function inquiryInstructions(record) {
  const {intent, channel} = readInquiryPolicy(record);
  const kind = intent === 'question' ? 'Question' : 'Booking help';
  const reply = {email:'Email reply requested',text:'Text reply requested',phone:'Phone call requested'}[channel];
  const action = {
    email: 'Reply by email only. Do not call, text, or add this inquiry to an automated prospect sequence.',
    text: 'Text the customer about this request. Do not call or add this inquiry to an automated prospect sequence.',
    phone: 'Call the customer about this request. Do not add this inquiry to an automated prospect sequence.'
  }[channel];
  return {request_intent:intent,contact_preference:channel,subject:kind + ' | ' + reply,inquiry_heading:kind + ': ' + reply,office_action:action};
}
