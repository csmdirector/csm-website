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
