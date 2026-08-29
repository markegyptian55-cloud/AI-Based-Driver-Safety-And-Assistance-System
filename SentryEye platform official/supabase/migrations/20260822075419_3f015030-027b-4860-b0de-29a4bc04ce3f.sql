-- ============ enums ============
CREATE TYPE public.fleet_role AS ENUM ('driver','manager','admin');
CREATE TYPE public.shift_status AS ENUM ('active','ending','completed','cancelled');
CREATE TYPE public.sync_status AS ENUM ('local','pending_sync','syncing','synced','sync_error');
CREATE TYPE public.risk_level AS ENUM ('low','moderate','high','critical');

-- ============ organizations ============
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  scoring_config jsonb NOT NULL DEFAULT '{
    "weights": {"eventRate": 0.30, "drowsinessRate": 0.30, "criticalDensity": 0.25, "closureSeverity": 0.15},
    "caps": {"eventRatePerHour": 12, "drowsinessRatePerHour": 8, "criticalPerHour": 2, "longestClosureMs": 4000},
    "thresholds": {"low": 85, "moderate": 70, "high": 50}
  }'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.fleet_role NOT NULL DEFAULT 'driver',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
GRANT SELECT ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

INSERT INTO public.organizations (id, name, timezone)
VALUES ('00000000-0000-4000-8000-000000000001', 'SentryEye Fleet', 'Africa/Cairo');

-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.org_members WHERE user_id = auth.uid() ORDER BY created_at LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_fleet_role()
RETURNS public.fleet_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.org_members WHERE user_id = auth.uid() ORDER BY created_at LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_org_manager(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = auth.uid() AND organization_id = _org AND role IN ('manager','admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.my_driver_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.drivers WHERE user_id = auth.uid() ORDER BY created_at LIMIT 1;
$$;

CREATE POLICY "Members read their organization" ON public.organizations
  FOR SELECT TO authenticated USING (id = public.current_org_id());
CREATE POLICY "Members read memberships in their org" ON public.org_members
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_org_manager(organization_id));

-- ============ drivers extension ============
ALTER TABLE public.drivers
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN employee_ref text,
  ADD COLUMN status text NOT NULL DEFAULT 'active';
CREATE INDEX idx_drivers_org ON public.drivers(organization_id);
CREATE INDEX idx_drivers_org_user ON public.drivers(organization_id, user_id);

CREATE POLICY "Managers read org drivers" ON public.drivers
  FOR SELECT TO authenticated USING (organization_id IS NOT NULL AND public.is_org_manager(organization_id));

-- ============ shifts ============
CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_shift_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.shift_status NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0,
  monitored_seconds integer NOT NULL DEFAULT 0,
  model_id uuid REFERENCES public.model_registry(id),
  model_name text,
  model_version text,
  model_imgsz integer,
  execution_provider text,
  precision text,
  device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_status public.sync_status NOT NULL DEFAULT 'synced',
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  UNIQUE (client_shift_id)
);
GRANT SELECT, INSERT, UPDATE ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX idx_one_active_shift_per_driver ON public.shifts(driver_id) WHERE status = 'active';
CREATE INDEX idx_shifts_org_driver ON public.shifts(organization_id, driver_id);
CREATE INDEX idx_shifts_org_created ON public.shifts(organization_id, created_at DESC);

CREATE POLICY "Drivers insert own shifts" ON public.shifts
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND organization_id = public.current_org_id());
CREATE POLICY "Drivers read own shifts" ON public.shifts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Drivers update own unfinalized shifts" ON public.shifts
  FOR UPDATE TO authenticated USING (user_id = auth.uid() AND finalized_at IS NULL)
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Managers read org shifts" ON public.shifts
  FOR SELECT TO authenticated USING (public.is_org_manager(organization_id));

-- ============ safety events ============
CREATE TABLE public.safety_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_event_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'low',
  confidence real NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  duration_seconds real NOT NULL DEFAULT 0,
  model_version text,
  evidence_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, client_event_id)
);
GRANT SELECT, INSERT ON public.safety_events TO authenticated;
GRANT ALL ON public.safety_events TO service_role;
ALTER TABLE public.safety_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_events_shift ON public.safety_events(shift_id);
CREATE INDEX idx_events_org_driver ON public.safety_events(organization_id, driver_id);
CREATE INDEX idx_events_org_created ON public.safety_events(organization_id, created_at DESC);

CREATE POLICY "Drivers insert own events" ON public.safety_events
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND organization_id = public.current_org_id());
CREATE POLICY "Drivers read own events" ON public.safety_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Managers read org events" ON public.safety_events
  FOR SELECT TO authenticated USING (public.is_org_manager(organization_id));

-- ============ shift reports ============
CREATE TABLE public.shift_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE UNIQUE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  monitored_seconds integer NOT NULL DEFAULT 0,
  total_events integer NOT NULL DEFAULT 0,
  critical_events integer NOT NULL DEFAULT 0,
  drowsiness_events integer NOT NULL DEFAULT 0,
  eyes_closed_events integer NOT NULL DEFAULT 0,
  yawning_events integer NOT NULL DEFAULT 0,
  phone_usage_events integer NOT NULL DEFAULT 0,
  other_events integer NOT NULL DEFAULT 0,
  event_rate real NOT NULL DEFAULT 0,
  drowsiness_rate real NOT NULL DEFAULT 0,
  avg_confidence real NOT NULL DEFAULT 0,
  safety_score real NOT NULL DEFAULT 100,
  risk_level public.risk_level NOT NULL DEFAULT 'low',
  recommendation text NOT NULL DEFAULT 'excellent',
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_name text,
  model_version text,
  execution_provider text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shift_reports TO authenticated;
GRANT ALL ON public.shift_reports TO service_role;
ALTER TABLE public.shift_reports ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_reports_org_driver ON public.shift_reports(organization_id, driver_id);
CREATE INDEX idx_reports_org_risk ON public.shift_reports(organization_id, risk_level);
CREATE INDEX idx_reports_org_finalized ON public.shift_reports(organization_id, finalized_at DESC);

CREATE POLICY "Drivers read own reports" ON public.shift_reports
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Managers read org reports" ON public.shift_reports
  FOR SELECT TO authenticated USING (public.is_org_manager(organization_id));

-- ============ daily stats ============
CREATE TABLE public.driver_daily_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  monitored_seconds integer NOT NULL DEFAULT 0,
  completed_shifts integer NOT NULL DEFAULT 0,
  total_events integer NOT NULL DEFAULT 0,
  critical_events integer NOT NULL DEFAULT 0,
  drowsiness_events integer NOT NULL DEFAULT 0,
  eyes_closed_events integer NOT NULL DEFAULT 0,
  yawning_events integer NOT NULL DEFAULT 0,
  phone_usage_events integer NOT NULL DEFAULT 0,
  event_rate real NOT NULL DEFAULT 0,
  drowsiness_rate real NOT NULL DEFAULT 0,
  safety_score real NOT NULL DEFAULT 100,
  risk_level public.risk_level NOT NULL DEFAULT 'low',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, date)
);
GRANT SELECT ON public.driver_daily_stats TO authenticated;
GRANT ALL ON public.driver_daily_stats TO service_role;
ALTER TABLE public.driver_daily_stats ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_daily_org_date ON public.driver_daily_stats(organization_id, date DESC);
CREATE INDEX idx_daily_driver_date ON public.driver_daily_stats(driver_id, date DESC);
CREATE INDEX idx_daily_org_risk ON public.driver_daily_stats(organization_id, risk_level);

CREATE POLICY "Drivers read own daily stats" ON public.driver_daily_stats
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Managers read org daily stats" ON public.driver_daily_stats
  FOR SELECT TO authenticated USING (public.is_org_manager(organization_id));

-- ============ manager notes ============
CREATE TABLE public.manager_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.manager_notes TO authenticated;
GRANT ALL ON public.manager_notes TO service_role;
ALTER TABLE public.manager_notes ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_notes_org_driver ON public.manager_notes(organization_id, driver_id);

CREATE POLICY "Managers manage org notes" ON public.manager_notes
  FOR ALL TO authenticated USING (public.is_org_manager(organization_id))
  WITH CHECK (public.is_org_manager(organization_id) AND manager_id = auth.uid());
CREATE POLICY "Drivers read notes about them" ON public.manager_notes
  FOR SELECT TO authenticated USING (driver_id = public.my_driver_id());

-- ============ finalize shift ============
CREATE OR REPLACE FUNCTION public.finalize_shift(_shift_id uuid, _monitored_seconds integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.shifts%ROWTYPE;
  cfg jsonb;
  tz text;
  hours real;
  n_total int; n_crit int; n_drowsy int; n_closed int; n_yawn int; n_phone int; n_other int;
  avg_conf real; ev_rate real; drowsy_rate real; crit_rate real;
  score real; lvl public.risk_level; rec text; fac jsonb;
  d date; rid uuid;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'shift not found'; END IF;
  IF s.user_id <> auth.uid() THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF s.finalized_at IS NOT NULL THEN
    SELECT id INTO rid FROM public.shift_reports WHERE shift_id = _shift_id;
    RETURN rid;
  END IF;

  SELECT scoring_config, timezone INTO cfg, tz FROM public.organizations WHERE id = s.organization_id;

  UPDATE public.shifts SET
    status = 'completed',
    ended_at = COALESCE(ended_at, now()),
    duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))::int),
    monitored_seconds = GREATEST(0, COALESCE(_monitored_seconds, monitored_seconds)),
    finalized_at = now(),
    sync_status = 'synced'
  WHERE id = _shift_id
  RETURNING * INTO s;

  SELECT
    count(*),
    count(*) FILTER (WHERE severity = 'critical'),
    count(*) FILTER (WHERE event_type IN ('drowsiness','microsleep')),
    count(*) FILTER (WHERE event_type = 'eyes_closed'),
    count(*) FILTER (WHERE event_type = 'yawning'),
    count(*) FILTER (WHERE event_type = 'phone_usage'),
    count(*) FILTER (WHERE event_type NOT IN ('drowsiness','microsleep','eyes_closed','yawning','phone_usage')),
    COALESCE(avg(confidence), 0)
  INTO n_total, n_crit, n_drowsy, n_closed, n_yawn, n_phone, n_other, avg_conf
  FROM public.safety_events WHERE shift_id = _shift_id;

  hours := GREATEST(s.monitored_seconds, 60)::real / 3600.0;
  ev_rate := n_total / hours;
  drowsy_rate := (n_drowsy + n_closed) / hours;
  crit_rate := n_crit / hours;

  score := 100.0
    - 100.0 * (cfg->'weights'->>'eventRate')::real * LEAST(1.0, ev_rate / NULLIF((cfg->'caps'->>'eventRatePerHour')::real,0))
    - 100.0 * (cfg->'weights'->>'drowsinessRate')::real * LEAST(1.0, drowsy_rate / NULLIF((cfg->'caps'->>'drowsinessRatePerHour')::real,0))
    - 100.0 * (cfg->'weights'->>'criticalDensity')::real * LEAST(1.0, crit_rate / NULLIF((cfg->'caps'->>'criticalPerHour')::real,0));
  score := GREATEST(0, LEAST(100, score));

  lvl := CASE
    WHEN score >= (cfg->'thresholds'->>'low')::real THEN 'low'
    WHEN score >= (cfg->'thresholds'->>'moderate')::real THEN 'moderate'
    WHEN score >= (cfg->'thresholds'->>'high')::real THEN 'high'
    ELSE 'critical' END;

  rec := CASE lvl
    WHEN 'low' THEN 'excellent'
    WHEN 'moderate' THEN 'monitor'
    WHEN 'high' THEN 'needs_attention'
    ELSE 'management_review' END;

  fac := jsonb_build_array(
    jsonb_build_object('label','Safety events per hour','value',round(ev_rate::numeric,2),'cap',(cfg->'caps'->>'eventRatePerHour')::real),
    jsonb_build_object('label','Drowsiness events per hour','value',round(drowsy_rate::numeric,2),'cap',(cfg->'caps'->>'drowsinessRatePerHour')::real),
    jsonb_build_object('label','Critical events per hour','value',round(crit_rate::numeric,2),'cap',(cfg->'caps'->>'criticalPerHour')::real),
    jsonb_build_object('label','Monitored minutes','value',round((s.monitored_seconds/60.0)::numeric,1))
  );

  INSERT INTO public.shift_reports (
    organization_id, shift_id, driver_id, user_id, monitored_seconds, total_events, critical_events,
    drowsiness_events, eyes_closed_events, yawning_events, phone_usage_events, other_events,
    event_rate, drowsiness_rate, avg_confidence, safety_score, risk_level, recommendation, factors,
    model_name, model_version, execution_provider
  ) VALUES (
    s.organization_id, s.id, s.driver_id, s.user_id, s.monitored_seconds, n_total, n_crit,
    n_drowsy, n_closed, n_yawn, n_phone, n_other,
    ev_rate, drowsy_rate, avg_conf, score, lvl, rec, fac,
    s.model_name, s.model_version, s.execution_provider
  )
  ON CONFLICT (shift_id) DO UPDATE SET generated_at = now()
  RETURNING id INTO rid;

  d := (s.started_at AT TIME ZONE COALESCE(tz,'UTC'))::date;

  INSERT INTO public.driver_daily_stats AS ds (
    organization_id, driver_id, user_id, date, monitored_seconds, completed_shifts, total_events,
    critical_events, drowsiness_events, eyes_closed_events, yawning_events, phone_usage_events,
    event_rate, drowsiness_rate, safety_score, risk_level, updated_at
  ) VALUES (
    s.organization_id, s.driver_id, s.user_id, d, s.monitored_seconds, 1, n_total,
    n_crit, n_drowsy, n_closed, n_yawn, n_phone,
    ev_rate, drowsy_rate, score, lvl, now()
  )
  ON CONFLICT (driver_id, date) DO UPDATE SET
    monitored_seconds = ds.monitored_seconds + EXCLUDED.monitored_seconds,
    completed_shifts = ds.completed_shifts + 1,
    total_events = ds.total_events + EXCLUDED.total_events,
    critical_events = ds.critical_events + EXCLUDED.critical_events,
    drowsiness_events = ds.drowsiness_events + EXCLUDED.drowsiness_events,
    eyes_closed_events = ds.eyes_closed_events + EXCLUDED.eyes_closed_events,
    yawning_events = ds.yawning_events + EXCLUDED.yawning_events,
    phone_usage_events = ds.phone_usage_events + EXCLUDED.phone_usage_events,
    event_rate = (ds.total_events + EXCLUDED.total_events) /
                 GREATEST(1.0, (ds.monitored_seconds + EXCLUDED.monitored_seconds) / 3600.0),
    drowsiness_rate = (ds.drowsiness_events + EXCLUDED.drowsiness_events + ds.eyes_closed_events + EXCLUDED.eyes_closed_events) /
                 GREATEST(1.0, (ds.monitored_seconds + EXCLUDED.monitored_seconds) / 3600.0),
    safety_score = (ds.safety_score * ds.completed_shifts + EXCLUDED.safety_score) / (ds.completed_shifts + 1),
    risk_level = LEAST(ds.risk_level, EXCLUDED.risk_level),
    updated_at = now();

  INSERT INTO public.audit_log (actor_id, actor_role, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'driver', 'shift.finalized', 'shift', s.id::text,
          jsonb_build_object('safety_score', score, 'risk_level', lvl, 'total_events', n_total));

  RETURN rid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.finalize_shift(uuid, integer) TO authenticated;

-- ============ signup bootstrap ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_first_user BOOLEAN;
  assigned_role public.app_role;
  default_org uuid := '00000000-0000-4000-8000-000000000001';
  fleet public.fleet_role;
  dname text;
BEGIN
  dname := COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));

  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (NEW.id, dname, NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO is_first_user;
  assigned_role := CASE WHEN is_first_user THEN 'admin'::public.app_role ELSE 'operator'::public.app_role END;

  INSERT INTO public.user_roles (user_id, role, granted_by)
  VALUES (NEW.id, assigned_role, NEW.id)
  ON CONFLICT (user_id, role) DO NOTHING;

  fleet := CASE WHEN lower(NEW.email) = 'markegyptian55@gmail.com' THEN 'manager'::public.fleet_role
                ELSE 'driver'::public.fleet_role END;

  INSERT INTO public.org_members (organization_id, user_id, role)
  VALUES (default_org, NEW.id, fleet)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  IF fleet = 'driver' THEN
    INSERT INTO public.drivers (user_id, full_name, driver_code, organization_id, employee_ref)
    VALUES (NEW.id, dname, upper(substr(replace(NEW.id::text,'-',''),1,8)), default_org,
            upper(substr(replace(NEW.id::text,'-',''),1,6)))
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_role, action, target_type, target_id, metadata)
  VALUES (NEW.id, assigned_role::text, 'auth.signup', 'user', NEW.id::text,
          jsonb_build_object('email', NEW.email, 'first_user', is_first_user, 'fleet_role', fleet));

  RETURN NEW;
END;
$$;

-- ============ realtime ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_reports;
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_daily_stats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;