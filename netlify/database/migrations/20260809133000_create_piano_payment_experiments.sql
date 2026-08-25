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
