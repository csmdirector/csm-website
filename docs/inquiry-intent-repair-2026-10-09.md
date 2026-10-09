## Form simplification

Owner requested one inquiry form without question-versus-booking categorization. The shared form now uses “How can we help?” and “Request Information.” Standard inquiry office emails use “Request Info.” Existing contact disclosure and workflow remain. Historical explicit reply preferences remain respected.

# Owner policy correction — October 9, 2026

This correction supersedes the channel-selection and blanket no-Opus portions of the initial repair below. Joe confirmed CSM’s established workflow: genuine submitted inquiries receive email/call/text follow-up. Browsing pricing or availability must not create an inquiry.

- Removed mandatory reply-method selection from all shared inquiry forms and the guided help form. Restored phone collection and clear disclosure before submission that CSM will follow up by email, phone, or text.
- Restored the existing durable, idempotent Opus handoff for genuine standard inquiries, including questions and booking help. Office notifications identify the requested help and instruct staff to address it before generic follow-up.
- Retained no-contact browsing, public pricing, repaired assets, durable office-email retries, and corrected click tracking.
- Explicit channel choices submitted during the earlier deployment remain honored. Confirmed historical submissions are not retroactively pushed to Opus by retries. Uncertain Opus delivery is flagged for reconciliation, never blindly retried.
- Analytics remains a read-only mirror for account creation: the durable inquiry delivery is the sole Opus writer, avoiding duplicates and historical queue replay.
- The separate prospect automation build remains in copy review; this correction does not install or launch it or alter native Opus system messages.

## Initial repair record — superseded where noted above

# Inquiry intent repair — October 9, 2026

## Problem
The pre-calendar form sent the office a “Request Info” notification even for independent booking. Six inline help forms had missing deployed JS/CSS. Request Info linked to the booking gate instead of collecting a question. Inquiry delivery could also create Opus prospects, exposing an email-only information seeker to account-level automation.

## Behavior after this change
- `/book-intro/`, `/book-piano-intro/` and the generic Lesson Fit route show instrument and location selectors, then navigate directly to existing Opus calendars. No personal details, website lead record, or office callback email is created by this new browsing step.
- Existing-family booking assistance remains an explicit office-help link. Normal booking/account confirmation behavior within Opus is unchanged.
- Request Info and all six inline forms offer question vs booking-help intent and email-only, text, or phone reply. Phone is shown/required only for text/phone, and discarded server-side for email-only requests.
- The guided selector preserves its recommendations, has explicit contact preference on its help branch, and never collects contact details on its independent-booking branch, regardless of a future lead-pipeline flag.
- Office subjects/headings identify intent and reply channel. The first email section gives the office action and says not to enroll inquiries in automated prospect sequences.
- Inquiry handling does not create Opus accounts. The analytics forwarding path is also blocked for inquiries, including previously queued Lesson Fit items, so it cannot undo this separation.
- Cached older compact forms still work, but independent browsing sends no office email. Legacy help requests without a recorded reply preference receive an email-only instruction. Historical confirmed notifications are not resent merely because the version changed.
- Contact preference and intent are persisted as a server-generated first line in the existing durable `student_note`; free-text answers cannot override it. No production database migration is required.
- Repeated submissions use the same submission ID and email payload. Success requires positive office-email confirmation; failed deliveries retain a retry path.
- Build output now includes root JS/CSS and the preservation check covers them. All six instrument forms and Request Info have a direct-contact fallback if scripts do not load.
- Pricing links are available in navigation and beside key acquisition actions, with tuition shown on the booking and inquiry pages. Booking-page clicks no longer emit Meta’s Lead event; explicit booking-help submissions do.

## Verification
Local tests use injected repositories/providers and cannot send live emails or create real Opus records. Coverage includes all six intent/channel combinations, email-only phone stripping, provider failures, retry idempotency, honeypots, old cached compact forms, existing-family routing, attribution and inquiry/Opus isolation. Existing bridge, lead pipeline, piano preregistration and output preservation checks also run. PostgreSQL concurrency is checked by the PR workflow against a disposable database.

Preview and production browser checks and deploy IDs are recorded separately after publishing.

## Boundaries
Already-created Opus prospects and their existing automation state are not retroactively changed. Staff must honor existing no-contact requests. Seven existing Google Ads campaign destinations and live GBP booking posts benefit from the repaired site paths without replacement campaigns. Stale five-location ad copy and the Middletown sitelink need account-side edits; the available Windsor actions cannot edit existing RSA content or remove those assets. No budget/bid/campaign strategy changes are part of this repair.
