# Request Info delivery repair — September 8, 2026

Prepared against `ef69dfccfb6644ad4add3e2296a22ec1fa6f7e89`, preserving the newly published compact enrollment form. Check the release pull request for publication and live verification status.

## Confirmed source defects

1. The optional guide used successful Netlify Forms storage as successful office delivery. Its direct office-email path was gated off in the earlier observed live build, and could fall back to storage after email failure.
2. The compact form's office-help handler called `intro-bridge-office-help`, which was absent from the email routes. The email helper returned `skipped: true, reason: no_route`; the handler ignored this result and recorded `sent`.
3. The handler also returned success when notification was disabled or failed. A retry could skip notification because the parent's choice was already saved.

The second and third findings are verified in the current repository source. The latest CLI deployment has no commit reference, so live function behavior still needs confirmation. Neither these defects nor the earlier missing inquiries establish the cause of the full enrollment decline.

## Corrected behavior

- The compact form keeps its layout, fields, booking URLs, and attribution. It requires explicit office-email confirmation before promising office follow-up.
- The office-help email route exists and uses **Request Info**. Explicit requests for office help send regardless of the flag governing optional initial booking notifications.
- A missing route, skipped send, provider error, or non-2xx idempotency conflict cannot count as accepted email.
- Unconfirmed office-help emails retry even when the choice was saved previously. Confirmed replays avoid a duplicate send. Old `sent` records without the new office-help payload cannot satisfy this check.
- The optional guide always uses the direct email endpoint for staff-help requests. On failure it attempts a complete Netlify backup, retains the answers, and shows an error. Backup storage cannot fire the success redirect or submission conversion.

Successful direct guide requests no longer also post to Netlify Forms. Netlify form counts therefore are not total inquiry counts after release.

## Verification

Passed locally, with no live emails or Opus records created:

- `node scripts/check-request-info-delivery.mjs`
- `npm run check:lead-pipeline`
- `npm run build`
- `npm run check:preserved`

Use staging preview before production, as required by the repository README. Recheck the live source before applying; main and staging were behind the CLI-published version. Provider acceptance is not final inbox delivery. Verify an identified request in info after publishing, and separately verify the expected Opus behavior. This patch preserves independent Opus pipeline flags and the deliberate no-precreation behavior of the self-booking bridge.

GitHub write access was restored after adding this website repository to the app installation. Publication and live delivery verification are tracked in the release pull request; local checks alone do not establish that the incident is resolved.
