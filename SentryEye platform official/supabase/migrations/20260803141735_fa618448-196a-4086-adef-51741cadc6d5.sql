ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'running',
  ADD COLUMN IF NOT EXISTS driver_label text,
  ADD COLUMN IF NOT EXISTS processing_time_ms integer,
  ADD COLUMN IF NOT EXISTS total_frames integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS analysed_frames integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_eye_frames integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed_eye_frames integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS yawn_frames integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eye_closure_ratio real,
  ADD COLUMN IF NOT EXISTS yawn_per_min real,
  ADD COLUMN IF NOT EXISTS total_alerts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alerts_low integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alerts_medium integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alerts_high integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alerts_critical integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_eye_closure_ms integer,
  ADD COLUMN IF NOT EXISTS avg_eye_closure_ms real,
  ADD COLUMN IF NOT EXISTS fatigue_level text,
  ADD COLUMN IF NOT EXISTS safety_score real;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_status_check CHECK (status IN ('running', 'completed', 'failed'));

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_fatigue_level_check CHECK (fatigue_level IS NULL OR fatigue_level IN ('low', 'medium', 'high', 'critical'));