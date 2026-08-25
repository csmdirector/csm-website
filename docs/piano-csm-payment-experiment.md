# Piano Intro CSM-hosted payment experiment

Status: local/preview architecture only. Production remains disabled.

## Finding

The documented Opus integration surface creates people through the inbound `client_create` webhook and emits client/subscription outbound events. It does not document an appointment-creation endpoint. The experiment therefore stops at a truthful boundary:

1. CSM stores the pre-registration and attribution.
2. The existing bridge confirms Opus created the parent/student.
3. CSM creates a Stripe **test-mode** Checkout Session for a server-configured, verified slot.
4. A signed Stripe webhook records the $42 test payment.
5. The record becomes `opus_fulfillment_status = pending_manual`.
6. No Opus booking, invoice, subscription, credit, or payment state is fabricated.

This proves CSM-owned payment can remove Opus card-entry friction. It does **not** yet prove inventory synchronization or automatic Opus booking fulfillment.

## Hard guardrails

- `ENABLE_PIANO_CSM_PAYMENT_EXPERIMENT=true` is required.
- `STRIPE_SECRET_KEY_TEST` must begin with `sk_test_`; live keys are rejected.
- `STRIPE_PIANO_CSM_PAYMENT_WEBHOOK_SECRET_TEST` must be a test endpoint secret.
- `PIANO_CSM_PAYMENT_TEST_SLOT_JSON` must contain one explicit future test slot with trusted Opus service, staff, location, and time identifiers.
- The CSM lead must exist, be a new-family path, have `opus_post_status = succeeded`, and match the configured slot location.
- Checkout Session creation is idempotent per lead and slot.
- Ambiguous Stripe session-creation failures are not retried automatically.
- Card data is collected only on Stripe-hosted Checkout.
- Only signed, test-mode, paid, USD $42 Checkout events can mark the experiment paid.
- Payment completion queues manual Opus fulfillment; it never creates an Opus booking automatically.
- No Google Ads or GTM conversion event is emitted.

## Preview routes

- `/book-piano-intro/csm-payment-experiment/?lead_id=...&slot_id=...`
- `/book-piano-intro/csm-payment-success/`
- `POST /api/piano-csm-payment-session`
- `POST /api/piano-csm-payment-webhook`

## Remaining proof required

Before this can become a launch candidate, CSM needs a supported source of live Opus availability and a supported way to reconcile the paid appointment in Opus. Without those two capabilities, the operational fallback is an office queue that manually books the selected slot and reconciles the separate Stripe payment.
