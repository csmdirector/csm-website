# Lead Pipeline Phase 1

Phase 1 proves the lead path without building the full analytics system.

## Database

Run `db/lead-pipeline.sql` against the production Postgres database. It creates:

- `events_raw`
- `people`
- `opus_forward_queue`
- `lead_funnel`

## Netlify environment variables

Required:

- `ENABLE_LEAD_PIPELINE` must be `true` before the pipeline writes to Postgres, forwards to Opus, serves recent events, or syncs Sheets. Any other value, including missing, is treated as disabled.
- `ENABLE_LESSON_FIT_DIRECT_SUBMIT` must be `true` before the Lesson Fit page posts to the CSM-owned submit endpoint. Any other value, including missing, keeps the existing Netlify Form submit path.
- `DATABASE_URL`
- `LEAD_EVENTS_LESSON_FIT_TOKEN`
- `LEAD_EVENTS_OPUS_TOKEN`
- `LEAD_PIPELINE_ADMIN_TOKEN`
- `OPUS_INBOUND_WEBHOOK_URL`

`LEAD_EVENTS_LESSON_FIT_TOKEN` can be supplied as `X-CSM-Source-Token`, `Authorization: Bearer ...`, or as a `token` query parameter when `source=lesson_fit`. Query-string tokens are only accepted for the `lesson_fit` source for backend webhook tests that cannot send custom headers.

Required for the Google Sheet mirror:

- `LEAD_FUNNEL_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Share the mirror spreadsheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL` as an editor. Humans should receive view-only access.

Optional:

- `LEAD_FUNNEL_SHEET_TAB` defaults to `lead_funnel`
- `OPUS_INBOUND_WEBHOOK_TOKEN` sends an `Authorization: Bearer ...` header to Opus if configured
- `LEAD_EVENTS_SOURCE_TOKENS_JSON` can replace per-source token env vars with a JSON object such as `{"opus":"...","lesson_fit":"..."}`

When `ENABLE_LEAD_PIPELINE` is not `true`, the pipeline returns a disabled/no-op response and does not touch Postgres, Opus, or Sheets. Lesson Fit Netlify Form handling and office email continue through the existing path.

When `ENABLE_LESSON_FIT_DIRECT_SUBMIT` is not `true`, the Lesson Fit page continues to post to Netlify Forms exactly as before. The direct submit endpoint returns disabled and does not send office email or touch the pipeline.

## Webhook URLs

### Lesson Fit direct submit endpoint

The production candidate Lesson Fit ingestion path is the CSM-owned `/api/lesson-fit-submit` endpoint, gated by `ENABLE_LESSON_FIT_DIRECT_SUBMIT`.

This endpoint:

- accepts the existing `lesson-fit-request` fields from the Lesson Fit page
- sends the office email through the same formatter/sender used by `form-email`
- captures the lead into the pipeline when `ENABLE_LEAD_PIPELINE=true`
- does not expose a privileged source token in browser JavaScript
- returns success when the office email sends, even if pipeline capture fails

The browser keeps the old Netlify Form submit path as the fail-open fallback. If the direct endpoint returns an error or cannot be reached, the page posts the same submission to the existing Netlify Form action. A client-generated `client_submission_id` is included in both paths and is used as the Resend idempotency key so a fallback retry does not intentionally create a second office email.

Do not enable `ENABLE_LESSON_FIT_DIRECT_SUBMIT` in production until this path has preview proof with real office email delivery, pipeline capture, Opus inbound forwarding, and a forced endpoint-failure fallback test.

### Lesson Fit Netlify Form notification

Netlify Form notification webhooks were tested as a possible automatic trigger, but they were not reliable enough to make production-critical for Lesson Fit ingestion. Do not use Netlify Form notifications as the canonical Lesson Fit pipeline trigger unless they are re-proven separately and monitored.

The existing `/api/lead-events` endpoint still supports Lesson Fit source-token ingestion for controlled tests and non-browser sources:

`https://cincinnatischoolofmusic.com/api/lead-events`

Headers:

- `X-CSM-Source-Token: <LEAD_EVENTS_LESSON_FIT_TOKEN>`
- `X-CSM-Source: lesson_fit`

Fallback webhook URL when Netlify cannot send custom headers:

`https://cincinnatischoolofmusic.com/api/lead-events?source=lesson_fit&token=<LEAD_EVENTS_LESSON_FIT_TOKEN>`

Do not put `LEAD_EVENTS_LESSON_FIT_TOKEN` in browser JavaScript. Query-string tokens are only acceptable for server-to-server notification tests where the URL is stored in Netlify or another backend service.

The Netlify `formSubmitted` event function is not the production-critical ingestion path. It may remain as non-canonical support for manual/local checks.

### Opus outbound webhooks

Opus outbound webhooks should point to:

`https://cincinnatischoolofmusic.com/api/lead-events`

Headers:

- `X-CSM-Source-Token: <LEAD_EVENTS_OPUS_TOKEN>`
- `X-CSM-Source: opus`

Events to enable:

- `client_create_trigger`
- `client_update_trigger`
- `subscription_create_trigger`
- `subscription_update_trigger`

## Admin checks

Recent captured events:

```sh
curl -H "X-CSM-Admin-Token: $LEAD_PIPELINE_ADMIN_TOKEN" \
  "https://cincinnatischoolofmusic.com/api/lead-events?limit=20"
```

Refresh the Google Sheet mirror:

```sh
curl -X POST -H "X-CSM-Admin-Token: $LEAD_PIPELINE_ADMIN_TOKEN" \
  "https://cincinnatischoolofmusic.com/api/lead-funnel-sync"
```

## Opus Request Info timing test

After the Opus outbound webhooks are configured, submit one test through the live Opus Request Info form at `/request-info`.

Then check recent events. If `client_create` appears immediately, Request Info is captured at lead creation time. If it appears only later when staff convert the prospect, the Phase 1 report should treat `opus_client_created_at` as the Opus-visible lead timestamp for that path.

## Phase 1 acceptance

- With `ENABLE_LESSON_FIT_DIRECT_SUBMIT=false`, Lesson Fit uses the existing Netlify Form path.
- With `ENABLE_LESSON_FIT_DIRECT_SUBMIT=true`, a Lesson Fit staff-help submission posts to `/api/lesson-fit-submit`.
- The direct endpoint sends the normal office email exactly once.
- If pipeline capture fails, the direct endpoint still returns success when the office email sends.
- If the direct endpoint fails before success, the browser falls back to the existing Netlify Form submit path.
- Lesson Fit direct submissions create one `events_raw` row.
- Lesson Fit rows upsert a `people` row by normalized email.
- Lesson Fit rows enqueue and attempt an Opus inbound webhook forward.
- Opus `client_create` links back to the same person by email or `opus_client_id`.
- Opus `subscription_create` sets `subscription_created_at`.
- Re-sending the same webhook keeps one `events_raw` row because `dedupe_key` is unique.
- `lead_funnel` returns one reporting row per person.

## Rollback

Set `ENABLE_LESSON_FIT_DIRECT_SUBMIT=false` in Netlify and redeploy, or unset it. Lesson Fit immediately returns to the existing Netlify Form submit path.

Set `ENABLE_LEAD_PIPELINE=false` in Netlify and redeploy, or unset it. The pipeline stops writing to Postgres, forwarding to Opus, reading recent events, retrying queue rows, and syncing Sheets.

Disabling either flag does not disable Netlify Forms. Disabling `ENABLE_LEAD_PIPELINE` does not disable Lesson Fit office email.

Queued `opus_forward_queue` rows stay in Postgres. They are not deleted. Re-enable the flag to resume scheduled retries, or inspect/replay manually from the database.

To revert the code while preserving lead data, deploy the previous site version or revert the Git commit. Do not drop the Postgres tables unless you intentionally want to discard the event ledger.

## Safe Deployment Sequence

1. Create Postgres database.
2. Run `db/lead-pipeline.sql`.
3. Add Netlify env vars with `ENABLE_LEAD_PIPELINE=false` and `ENABLE_LESSON_FIT_DIRECT_SUBMIT=false`.
4. Deploy to preview.
5. Confirm Lesson Fit still stores a Netlify form submission and sends the normal office email.
6. Turn `ENABLE_LEAD_PIPELINE=true` and `ENABLE_LESSON_FIT_DIRECT_SUBMIT=true` in preview and redeploy.
7. Submit a staff-help Lesson Fit through the deploy preview.
8. Confirm office email arrived exactly once.
9. Confirm `events_raw` row and `people` row.
10. Confirm Opus inbound created/linked prospect.
11. Temporarily force the direct endpoint to fail in preview and confirm the browser falls back to the existing Netlify Form path.
12. Configure Opus outbound webhook to preview/test endpoint.
13. Confirm `client_create` event arrives.
14. Send duplicate event and confirm no duplicate `events_raw` row and no duplicate `people` row.
15. Trigger `subscription_create` and confirm `subscription_created_at`.
16. Run `/api/lead-funnel-sync` and verify the read-only Sheet mirror.
17. Only then merge to production.
