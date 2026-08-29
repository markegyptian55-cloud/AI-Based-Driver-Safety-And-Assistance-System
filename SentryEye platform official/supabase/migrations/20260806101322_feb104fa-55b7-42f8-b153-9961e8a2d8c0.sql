CREATE TABLE public.diagnostics_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  redaction_summary text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  view_count integer NOT NULL DEFAULT 0
);

CREATE INDEX diagnostics_shares_expires_at_idx ON public.diagnostics_shares (expires_at);

GRANT ALL ON public.diagnostics_shares TO service_role;
GRANT SELECT, DELETE ON public.diagnostics_shares TO authenticated;

ALTER TABLE public.diagnostics_shares ENABLE ROW LEVEL SECURITY;

-- Reads by token happen through a privileged server function, never the Data
-- API: knowing a row id must never be enough to read someone else's logs.
CREATE POLICY "Owners can list their own shares"
  ON public.diagnostics_shares FOR SELECT TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Owners can revoke their own shares"
  ON public.diagnostics_shares FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- Housekeeping: an expired share is deleted, not just hidden.
CREATE OR REPLACE FUNCTION public.purge_expired_diagnostics_shares()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM public.diagnostics_shares WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_diagnostics_shares() FROM PUBLIC, anon, authenticated;