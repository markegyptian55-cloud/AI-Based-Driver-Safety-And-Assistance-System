CREATE TABLE public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  driver_code text NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, driver_code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own drivers" ON public.drivers
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_drivers_updated_at
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_drivers_user ON public.drivers(user_id);

ALTER TABLE public.sessions
  ADD COLUMN driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL;

CREATE INDEX idx_sessions_driver ON public.sessions(driver_id);