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
- `DATABASE_URL`
- `LEAD_EVENTS_LESSON_FIT_TOKEN`
- `LEAD_EVENTS_OPUS_TOKEN`
- `LEAD_PIPELINE_ADMIN_TOKEN`
- `OPUS_INBOUND_WEBHOOK_URL`

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

## Webhook URLs

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

- Lesson Fit Netlify Form submissions create one `events_raw` row.
- Lesson Fit rows upsert a `people` row by normalized email.
- Lesson Fit rows enqueue and attempt an Opus inbound webhook forward.
- Opus `client_create` links back to the same person by email or `opus_client_id`.
- Opus `subscription_create` sets `subscription_created_at`.
- Re-sending the same webhook keeps one `events_raw` row because `dedupe_key` is unique.
- `lead_funnel` returns one reporting row per person.

## Rollback

Set `ENABLE_LEAD_PIPELINE=false` in Netlify and redeploy, or unset it. The pipeline stops writing to Postgres, forwarding to Opus, reading recent events, retrying queue rows, and syncing Sheets.

Disabling does not disable Netlify Forms and does not disable Lesson Fit office email.

Queued `opus_forward_queue` rows stay in Postgres. They are not deleted. Re-enable the flag to resume scheduled retries, or inspect/replay manually from the database.

To revert the code while preserving lead data, deploy the previous site version or revert the Git commit. Do not drop the Postgres tables unless you intentionally want to discard the event ledger.

## Safe Deployment Sequence

1. Create Postgres database.
2. Run `db/lead-pipeline.sql`.
3. Add Netlify env vars with `ENABLE_LEAD_PIPELINE=false`.
4. Deploy to preview.
5. Confirm Lesson Fit still stores a Netlify form submission and sends the normal office email.
6. Turn `ENABLE_LEAD_PIPELINE=true` in preview and redeploy.
7. Submit test Lesson Fit.
8. Confirm `events_raw` row and `people` row.
9. Confirm Opus inbound created/linked prospect.
10. Configure Opus outbound webhook to preview/test endpoint.
11. Confirm `client_create` event arrives.
12. Send duplicate event and confirm no duplicate `events_raw` row and no duplicate `people` row.
13. Trigger `subscription_create` and confirm `subscription_created_at`.
14. Run `/api/lead-funnel-sync` and verify the read-only Sheet mirror.
15. Only then merge to production.
