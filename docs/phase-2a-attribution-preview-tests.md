# Phase 2A Attribution Preview Tests

Preview target: `http://127.0.0.1:4324/`

Date checked: 2026-07-06

## Required scenarios

- Direct ad click to `/lesson-fit/`
  - Use `/lesson-fit/?gclid=DLF_GCLID&utm_source=google&utm_medium=cpc&utm_campaign=direct_lf&utm_term=piano&utm_content=headline`.
  - Confirm `csmAttribution.latest_touch`, `csmLessonFitAttribution`, hidden fields, and `tracking_summary` contain the click id, UTMs, `first_landing_path`, and `latest_landing_path`.

- Homepage ad click, then `/lesson-fit/`
  - Use `/?gclid=HOME_GCLID&utm_source=google&utm_medium=cpc&utm_campaign=home_campaign&utm_term=music%20lessons&utm_content=home_ad`.
  - Navigate to `/lesson-fit/`.
  - Confirm Lesson Fit hidden fields preserve the homepage click and do not replace `latest_landing_path` with `/lesson-fit/`.

- Instrument-page ad click, then `/lesson-fit/`
  - Use `/piano-lessons?gclid=PIANO_GCLID&utm_source=google&utm_medium=cpc&utm_campaign=piano_campaign&utm_term=piano%20lessons&utm_content=piano_ad`.
  - Navigate to `/lesson-fit/`.
  - Confirm Lesson Fit hidden fields preserve the instrument-page click.

- Repeat ad click
  - First visit `/?gclid=FIRST_GCLID&utm_source=google&utm_medium=cpc&utm_campaign=first_campaign`.
  - Then visit `/piano-lessons?gclid=SECOND_GCLID&utm_source=google&utm_medium=cpc&utm_campaign=second_campaign`.
  - Confirm `first_touch.first_landing_path` remains the first click and `latest_touch.latest_landing_path` moves to the second click.

- Legacy Lesson Fit attribution TTL
  - Seed `localStorage.csmLessonFitAttribution` with a `timestamp`, `attribution_timestamp`, or `last_paid_click_timestamp` older than 90 days, then load a CSM page.
  - Confirm the old legacy attribution does not migrate into `csmAttribution`.
  - Confirm stale or undated legacy attribution is removed so it cannot keep resurrecting.
  - Seed a fresh legacy attribution object and confirm it can still migrate when `csmAttribution` is empty.
  - Confirm `window.CSMAttribution.clear()` removes both `csmAttribution` and `csmLessonFitAttribution`.

- Staff-help submit
  - Choose a staff-help path, then submit with a local preview fetch stub.
  - Confirm the submitted body includes separate `gclid`, `gbraid`, `wbraid`, UTM fields, `first_landing_path`, `latest_landing_path`, `referrer`, and `tracking_summary`.
  - Confirm Lesson Fit draft state does not retain test name, email, or phone values in localStorage.

- Self-booking handoff
  - Choose a Piano self-booking path.
  - Confirm `recommended_url` is an Opus URL decorated with latest-touch attribution.
  - Confirm `lesson_fit_self_booking_handoff` remains a diagnostic dataLayer event.
  - Confirm no booking/conversion-style event fires on handoff.

## Notes

- Phase 2A does not enable production lead-pipeline functions, Opus forwarding, Google Ads offline uploads, enhanced conversions, or campaign changes.
- Working Opus assumption: Opus does not store or export full `gclid`, `gbraid`, `wbraid`, UTM, or landing-page attribution. Only coarse `?tag=` values survive as shortened client tags, so future offline attribution should not depend on Opus retaining click IDs.
