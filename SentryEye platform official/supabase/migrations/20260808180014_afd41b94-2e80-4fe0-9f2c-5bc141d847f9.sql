ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS fps_p50 real,
  ADD COLUMN IF NOT EXISTS fps_p95 real,
  ADD COLUMN IF NOT EXISTS latency_p50_ms real,
  ADD COLUMN IF NOT EXISTS latency_p95_ms real,
  ADD COLUMN IF NOT EXISTS infer_p50_ms real,
  ADD COLUMN IF NOT EXISTS infer_p95_ms real,
  ADD COLUMN IF NOT EXISTS drop_rate real,
  ADD COLUMN IF NOT EXISTS dropped_frames integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worst_stall_ms integer;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS fallback_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fallback_min_fps real NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS fallback_max_latency_ms integer NOT NULL DEFAULT 300;