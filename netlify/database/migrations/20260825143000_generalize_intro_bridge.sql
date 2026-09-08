ALTER TABLE piano_preregistrations
  ADD COLUMN IF NOT EXISTS service_slug text NOT NULL DEFAULT 'piano';

UPDATE piano_preregistrations
SET service_slug = CASE
  WHEN lower(instrument) = 'music discovery' THEN 'music-discovery'
  WHEN lower(instrument) = 'drums' THEN 'drums'
  WHEN lower(instrument) IN ('piano', 'guitar', 'voice', 'violin') THEN lower(instrument)
  ELSE service_slug
END;

CREATE INDEX IF NOT EXISTS piano_preregistrations_service_created_idx
  ON piano_preregistrations (service_slug, created_at DESC);

CREATE INDEX IF NOT EXISTS piano_preregistrations_service_reconciliation_idx
  ON piano_preregistrations (service_slug, reconciliation_status, submitted_at DESC);
