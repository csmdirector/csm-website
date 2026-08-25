# Piano Pre-Registration: CSM Attribution + Vanilla Opus Checkout

Staged route: `/book-piano-intro/`

Production remains disabled. This document describes the preview architecture approved on 2026-08-10 after the paid-checkout comparison tests.

## Decision

The ready-to-book Piano Intro path must **not** call the Opus inbound `client_create` webhook.

The supported new-family flow is:

1. CSM collects parent/student identity, location, rough schedule preference, and attribution.
2. CSM writes a pre-registration row and sends the office notification.
3. CSM shows the exact location-specific public Opus Piano Intro URL.
4. The parent enters Opus as a brand-new customer.
5. Opus creates the family, handles card setup/payment, and creates the booking in its normal checkout.
6. A later reconciliation process may match the CSM lead to the Opus family/booking using normalized email, phone, time, and location. That reconciliation is not part of this preview.

The CSM page does not create a booking, invoice, payment, subscription, proposal, schedule entry, Opus parent, or Opus student.

## Why the webhook was removed from this buyer path

The paid comparison isolated an Opus checkout defect:

| Test state | Checkout result |
| --- | --- |
| Webhook-created parent + existing student + new card | Failed: Stripe Payment Element not mounted |
| Existing parent + student added through ordinary Opus flow + new card | Failed with the same error |
| Manually created parent + student + new card | Failed with the same error |
| Pristine new parent + new student + new card | Succeeded; $42 paid booking created |

The failure follows the **existing student/dependent checkout state**, not the webhook origin. Pre-creating the family therefore puts a ready buyer on the broken branch. The pristine Opus new-family flow is the only paid path proven to work.

The successful control booking was canceled, refunded, voided, and its fake profiles were removed. A surgical Opus support report was sent separately.

## Runtime flags

- `ENABLE_PIANO_PREREGISTRATION=true` enables the submit endpoint.
- `ENABLE_PIANO_PREREGISTRATION_OFFICE_EMAIL=true` sends the office notification through the existing Resend formatter.
- Netlify Database stores the complete lead and delivery states. A deploy preview uses its isolated database branch.
- `DATABASE_URL`, `POSTGRES_URL`, or `NETLIFY_DATABASE_URL` can override the managed connection for local or externally hosted Postgres.
- `RESEND_API_KEY` and the existing form-email settings deliver the office notification.

The ready-buyer function does not read `OPUS_INBOUND_WEBHOOK_URL`, `OPUS_INBOUND_WEBHOOK_TOKEN`, or the old forwarding flag. Setting a stale Opus variable cannot reactivate `client_create` on this route.

Keep the route and office-email flags false or unset in production until preview acceptance is complete.

## Stored record and audit states

The row keeps:

- CSM lead ID and browser submission ID
- raw and normalized parent email/phone
- parent/student identity
- student age or birthdate
- instrument, location, rough time preference, and exact booking URL
- structured attribution plus an office-readable summary
- duplicate fingerprint and any earlier matching CSM lead ID
- office notification state
- legacy Opus audit columns, with an empty `opus_payload`

Ready-buyer Opus audit states:

- `not_attempted_vanilla_handoff`: new-family lead stored; no `client_create` attempt; proceed to normal Opus checkout.
- `not_attempted_recent_duplicate`: another matching CSM submission exists inside 30 minutes; the new row is still stored; no `client_create` attempt.
- `skipped_existing_family`: existing-family lead stored; no `client_create` attempt; office assistance required.

Every public response and office notification also declares:

- `handoff_mode = vanilla_opus_checkout`
- `opus_client_create_attempted = false` / `No`

## Idempotency and duplicates

- The browser generates a stable `client_submission_id`; replaying the same ID returns the existing row and does not resend the office email.
- Separate submissions with the same normalized email, phone, Piano instrument, and location inside 30 minutes are both stored and linked.
- A database advisory lock serializes near-simultaneous submissions with the same fingerprint.
- No Opus post exists to retry, time out, or duplicate in this flow.

## Existing families

When `existing_family=yes`:

- store the complete CSM record and attribution;
- set `skipped_existing_family` and require office follow-up;
- do not call `client_create`;
- do not show the new-family Opus booking button on the confirmation page;
- show call/text/email actions and the CSM reference ID.

This protects existing students from the checkout state that failed in all three comparison tests.

## Attribution and conversion rules

- Structured attribution stays in the CSM row.
- The office notification contains the attribution summary and CSM context.
- No tags or `?tag=` values are sent to Opus.
- Form submission and the confirmation-page click are not Google Ads booking conversions.
- No fake Google Ads conversion event is emitted by either page.
- A future reconciliation job should attach actual Opus booking/payment evidence to the CSM lead before any downstream booking conversion is considered.

## Preview acceptance

1. Apply the database schema to the preview database.
2. Enable the preregistration route and, optionally, office email in preview only.
3. Submit fake new-family data.
4. Confirm the row contains the full attribution, normalized identity, location URL, and `not_attempted_vanilla_handoff`.
5. Confirm no inbound Opus webhook request occurred and no Opus profile exists before the booking link is opened.
6. Confirm the confirmation page links to the selected location's exact Opus URL.
7. Start the Opus flow as a brand-new customer and confirm the normal family/payment path loads.
8. Confirm no Google Ads booking conversion fires from the CSM form or link click.
9. Submit fake existing-family data and confirm the page shows office assistance without the new-family Opus CTA.

Do not publish production, modify Google Ads/GTM, create a CSM Stripe payment flow, or run automated live duplicate tests as part of this preview.

### Verified branch preview — 2026-08-10

Preview: `https://piano-preregistration-preview--csm-website.netlify.app/book-piano-intro/`

New-family verification:

- Fake CSM lead: `CSM-PRE-20260810-A7470394`
- Preferred location: CSM Mason
- Exact CTA: `https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-mason`
- `opus_post_status = not_attempted_vanilla_handoff`
- `opus_payload = {}`
- `opus_attempted_at = null`
- office notification: `sent`
- office follow-up: `false`

Existing-family verification:

- Fake CSM lead: `CSM-PRE-20260810-A961710E`
- Preferred location: CSM Anderson
- `opus_post_status = skipped_existing_family`
- `opus_payload = {}`
- `opus_attempted_at = null`
- office notification: `sent`
- office follow-up: `true`
- confirmation page showed the office-assisted message and the new-family Opus CTA was not visible

The preview page's data layer contained no booking or conversion event. Both rows exist only in the isolated `piano-preregistration-preview` database branch; no Opus parent/student was created by this code path.

## Reserved future use of `client_create`

Inbound `client_create` may still be useful for leads who are **not ready to self-book** and need office nurture. That should be a separate function, table state, and operating procedure. It must not share an automatic path with the ready-buyer checkout.

## Rollback

Set `ENABLE_PIANO_PREREGISTRATION=false` or remove the staged route in a later deploy. Existing CSM lead rows remain available for office follow-up. Because the ready-buyer route never calls Opus, rollback cannot leave an ambiguous webhook attempt behind.
