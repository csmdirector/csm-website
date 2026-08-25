ALTER TABLE piano_preregistrations
  ADD COLUMN IF NOT EXISTS conversion_eligible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS conversion_exclusion_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS piano_preregistrations_matched_booking_unique_idx
  ON piano_preregistrations (matched_opus_booking_id)
  WHERE matched_opus_booking_id IS NOT NULL;
