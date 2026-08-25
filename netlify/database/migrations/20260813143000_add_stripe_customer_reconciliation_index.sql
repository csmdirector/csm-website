CREATE INDEX IF NOT EXISTS piano_intro_opus_events_stripe_customer_idx
  ON piano_intro_opus_events ((evidence->>'stripeCustomerId'), received_at DESC);
