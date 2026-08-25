CREATE TABLE IF NOT EXISTS piano_intro_opus_events (
  id bigserial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  external_id text,
  opus_client_id text,
  opus_student_id text,
  opus_subscription_id text,
  opus_booking_id text,
  payload jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_status text NOT NULL DEFAULT 'received',
  reconciliation_reason text,
  match_method text,
  matched_csm_lead_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  process_error text
);

CREATE INDEX IF NOT EXISTS piano_intro_opus_events_client_idx
  ON piano_intro_opus_events (opus_client_id, received_at DESC);

CREATE INDEX IF NOT EXISTS piano_intro_opus_events_subscription_idx
  ON piano_intro_opus_events (opus_subscription_id, received_at DESC);

CREATE INDEX IF NOT EXISTS piano_intro_opus_events_status_idx
  ON piano_intro_opus_events (reconciliation_status, received_at DESC);

ALTER TABLE piano_preregistrations
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reconciliation_match_method text,
  ADD COLUMN IF NOT EXISTS reconciliation_reason text,
  ADD COLUMN IF NOT EXISTS reconciliation_manual_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS matched_opus_event_id bigint,
  ADD COLUMN IF NOT EXISTS matched_opus_client_id text,
  ADD COLUMN IF NOT EXISTS matched_opus_student_id text,
  ADD COLUMN IF NOT EXISTS matched_opus_subscription_id text,
  ADD COLUMN IF NOT EXISTS matched_opus_booking_id text,
  ADD COLUMN IF NOT EXISTS opus_service_name text,
  ADD COLUMN IF NOT EXISTS opus_location_name text,
  ADD COLUMN IF NOT EXISTS opus_booking_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS opus_payment_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS opus_booking_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS opus_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS opus_amount_cents integer,
  ADD COLUMN IF NOT EXISTS opus_currency text,
  ADD COLUMN IF NOT EXISTS reconciliation_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'piano_intro_opus_events_lead_fkey'
      AND conrelid = 'piano_intro_opus_events'::regclass
  ) THEN
    ALTER TABLE piano_intro_opus_events
      ADD CONSTRAINT piano_intro_opus_events_lead_fkey
      FOREIGN KEY (matched_csm_lead_id)
      REFERENCES piano_preregistrations(csm_lead_id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'piano_preregistrations_opus_event_fkey'
      AND conrelid = 'piano_preregistrations'::regclass
  ) THEN
    ALTER TABLE piano_preregistrations
      ADD CONSTRAINT piano_preregistrations_opus_event_fkey
      FOREIGN KEY (matched_opus_event_id)
      REFERENCES piano_intro_opus_events(id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE piano_preregistrations
SET reconciliation_status = 'existing_family_office',
    reconciliation_manual_review_required = true,
    reconciliation_reason = COALESCE(reconciliation_reason, 'existing_family_launch_path'),
    updated_at = now()
WHERE existing_family = true
  AND reconciliation_status = 'pending';

CREATE INDEX IF NOT EXISTS piano_preregistrations_reconciliation_status_idx
  ON piano_preregistrations (reconciliation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS piano_preregistrations_reconciliation_email_idx
  ON piano_preregistrations (parent_email_norm, created_at DESC)
  WHERE reconciliation_status <> 'matched_paid';

CREATE INDEX IF NOT EXISTS piano_preregistrations_reconciliation_phone_idx
  ON piano_preregistrations (parent_phone_norm, created_at DESC)
  WHERE reconciliation_status <> 'matched_paid';
