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
