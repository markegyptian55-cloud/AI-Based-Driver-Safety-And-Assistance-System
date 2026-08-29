CREATE TABLE public.benchmark_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  frame_source text NOT NULL DEFAULT 'camera',
  frame_count integer NOT NULL DEFAULT 0,
  device jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  best_model_id uuid,
  best_model_label text,
  best_fps real,
  best_latency_p95_ms real,
  notes text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.benchmark_runs TO authenticated;
GRANT ALL ON public.benchmark_runs TO service_role;

ALTER TABLE public.benchmark_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own benchmark runs"
ON public.benchmark_runs FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE INDEX benchmark_runs_user_created_idx ON public.benchmark_runs (user_id, created_at DESC);