CREATE TABLE IF NOT EXISTS events_raw (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  event_type text NOT NULL,
  external_id text,
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  person_id bigint,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  process_error text
);

CREATE INDEX IF NOT EXISTS events_raw_received_at_idx ON events_raw (received_at DESC);
CREATE INDEX IF NOT EXISTS events_raw_source_event_idx ON events_raw (source, event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS events_raw_person_id_idx ON events_raw (person_id);

CREATE TABLE IF NOT EXISTS people (
  id bigserial PRIMARY KEY,
  email_norm text,
  phone_norm text,
  display_name text,
  opus_client_id text UNIQUE,
  opus_status text,
  first_source text,
  first_utm jsonb,
  first_context text,
  lead_at timestamptz,
  opus_client_created_at timestamptz,
  subscription_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS people_email_norm_unique ON people (email_norm) WHERE email_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS people_phone_norm_idx ON people (phone_norm);
CREATE INDEX IF NOT EXISTS people_lead_at_idx ON people (lead_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_raw_person_id_fkey'
      AND conrelid = 'events_raw'::regclass
  ) THEN
    ALTER TABLE events_raw
      ADD CONSTRAINT events_raw_person_id_fkey
      FOREIGN KEY (person_id) REFERENCES people(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS opus_forward_queue (
  id bigserial PRIMARY KEY,
  event_raw_id bigint NOT NULL UNIQUE REFERENCES events_raw(id) ON DELETE CASCADE,
  person_id bigint REFERENCES people(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_status integer,
  last_error text,
  opus_response jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opus_forward_queue_status_next_idx
  ON opus_forward_queue (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS piano_preregistrations (
  csm_lead_id text PRIMARY KEY,
  client_submission_id text NOT NULL UNIQUE,
  parent_name text NOT NULL,
  parent_email text NOT NULL,
  parent_email_norm text NOT NULL,
  parent_phone text NOT NULL,
  parent_phone_norm text NOT NULL,
  student_name text NOT NULL,
  student_birthdate date,
  student_age text,
  instrument text NOT NULL DEFAULT 'Piano',
  preferred_location text NOT NULL,
  preferred_location_slug text NOT NULL,
  preferred_time_window text NOT NULL,
  existing_family boolean NOT NULL DEFAULT false,
  booking_url text NOT NULL,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  attribution_summary text NOT NULL,
  student_note text NOT NULL,
  dedupe_fingerprint text NOT NULL,
  duplicate_of_lead_id text REFERENCES piano_preregistrations(csm_lead_id) ON DELETE SET NULL,
  opus_payload jsonb NOT NULL,
  opus_post_status text NOT NULL,
  opus_attempted_at timestamptz,
  opus_http_status integer,
  opus_response_body text,
  opus_error text,
  office_follow_up_required boolean NOT NULL DEFAULT false,
  office_notification_status text NOT NULL DEFAULT 'pending',
  office_notification_payload jsonb,
  office_notification_error text,
  office_notified_at timestamptz,
  reconciliation_status text NOT NULL DEFAULT 'pending',
  reconciliation_match_method text,
  reconciliation_reason text,
  reconciliation_manual_review_required boolean NOT NULL DEFAULT false,
  reconciled_at timestamptz,
  matched_opus_event_id bigint,
  matched_opus_client_id text,
  matched_opus_student_id text,
  matched_opus_subscription_id text,
  matched_opus_booking_id text,
  opus_service_name text,
  opus_location_name text,
  opus_booking_status text NOT NULL DEFAULT 'unverified',
  opus_payment_status text NOT NULL DEFAULT 'unverified',
  opus_booking_start_at timestamptz,
  opus_paid_at timestamptz,
  opus_amount_cents integer,
  opus_currency text,
  reconciliation_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  conversion_eligible boolean NOT NULL DEFAULT true,
  conversion_exclusion_reason text,
  submitted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS piano_preregistrations_dedupe_created_idx
  ON piano_preregistrations (dedupe_fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS piano_preregistrations_opus_status_idx
  ON piano_preregistrations (opus_post_status, created_at DESC);

CREATE INDEX IF NOT EXISTS piano_preregistrations_office_follow_up_idx
  ON piano_preregistrations (office_follow_up_required, created_at DESC)
  WHERE office_follow_up_required = true;

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
  matched_csm_lead_id text REFERENCES piano_preregistrations(csm_lead_id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS piano_preregistrations_reconciliation_status_idx
  ON piano_preregistrations (reconciliation_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS piano_preregistrations_matched_booking_unique_idx
  ON piano_preregistrations (matched_opus_booking_id)
  WHERE matched_opus_booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS piano_intro_payment_experiments (
  experiment_id text PRIMARY KEY,
  csm_lead_id text NOT NULL REFERENCES piano_preregistrations(csm_lead_id) ON DELETE RESTRICT,
  slot_id text NOT NULL,
  slot_snapshot jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents = 4200),
  currency text NOT NULL CHECK (currency = 'usd'),
  payment_status text NOT NULL,
  stripe_checkout_session_id text UNIQUE,
  stripe_checkout_url text,
  stripe_payment_intent_id text,
  stripe_error text,
  last_stripe_event_id text UNIQUE,
  opus_fulfillment_status text NOT NULL DEFAULT 'not_started',
  office_follow_up_required boolean NOT NULL DEFAULT true,
  checkout_created_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (csm_lead_id, slot_id)
);

CREATE INDEX IF NOT EXISTS piano_intro_payment_status_idx
  ON piano_intro_payment_experiments (payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS piano_intro_payment_fulfillment_idx
  ON piano_intro_payment_experiments (opus_fulfillment_status, created_at DESC);

CREATE OR REPLACE VIEW lead_funnel AS
SELECT
  p.id AS person_id,
  p.display_name,
  p.email_norm,
  p.phone_norm,
  p.first_source,
  p.first_utm ->> 'utm_source' AS utm_source,
  p.first_utm ->> 'utm_medium' AS utm_medium,
  p.first_utm ->> 'utm_campaign' AS utm_campaign,
  p.first_utm ->> 'utm_content' AS utm_content,
  p.first_utm ->> 'utm_term' AS utm_term,
  p.lead_at,
  p.opus_client_created_at,
  p.subscription_created_at,
  CASE
    WHEN p.lead_at IS NOT NULL AND p.subscription_created_at IS NOT NULL
      THEN ROUND((EXTRACT(EPOCH FROM (p.subscription_created_at - p.lead_at)) / 86400.0)::numeric, 2)
    ELSE NULL
  END AS days_to_enroll,
  p.opus_status AS current_opus_status,
  p.first_context AS user_context,
  p.opus_client_id,
  p.updated_at
FROM people p;
