ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS calibration_profile jsonb,
  ADD COLUMN IF NOT EXISTS calibration_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS calibration_sync_enabled boolean NOT NULL DEFAULT true;