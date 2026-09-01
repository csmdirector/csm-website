ALTER TABLE piano_preregistrations
  ADD COLUMN IF NOT EXISTS handoff_choice text,
  ADD COLUMN IF NOT EXISTS handoff_choice_selected_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'piano_preregistrations_handoff_choice_check'
  ) THEN
    ALTER TABLE piano_preregistrations
      ADD CONSTRAINT piano_preregistrations_handoff_choice_check
      CHECK (handoff_choice IS NULL OR handoff_choice IN ('online_booking', 'office_help'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS piano_preregistrations_handoff_choice_idx
  ON piano_preregistrations (handoff_choice, handoff_choice_selected_at DESC);
