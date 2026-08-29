
-- =========================================================================
-- 1. ROLES + HELPERS
-- =========================================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'researcher', 'operator', 'viewer');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;

CREATE OR REPLACE FUNCTION public.current_user_roles()
RETURNS public.app_role[] LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(role), ARRAY[]::public.app_role[]) FROM public.user_roles WHERE user_id = auth.uid();
$$;

CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- 2. UPDATED_AT HELPER
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- =========================================================================
-- 3. PROFILES
-- =========================================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles readable by authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Admins manage profiles" ON public.profiles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================================
-- 4. USER SETTINGS
-- =========================================================================
CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  drowsy_perclos_threshold REAL NOT NULL DEFAULT 0.4,
  eye_closed_ms_threshold INT NOT NULL DEFAULT 800,
  yawn_rate_per_min_threshold REAL NOT NULL DEFAULT 3,
  alarm_enabled BOOLEAN NOT NULL DEFAULT true,
  alarm_volume REAL NOT NULL DEFAULT 0.7,
  browser_notifications_enabled BOOLEAN NOT NULL DEFAULT false,
  inference_provider TEXT NOT NULL DEFAULT 'browser' CHECK (inference_provider IN ('browser','remote')),
  remote_api_url TEXT,
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','light','system')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own settings" ON public.user_settings
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins read all settings" ON public.user_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_user_settings_updated_at BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================================
-- 5. MODEL REGISTRY (model-agnostic)
-- =========================================================================
CREATE TABLE public.model_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  engine_kind TEXT NOT NULL,           -- 'ultralytics-v8', 'rtdetr', 'triton', ...
  head_format TEXT NOT NULL,           -- decoder pipeline id
  framework TEXT NOT NULL,             -- 'onnx', 'pytorch', 'tensorrt', ...
  file_path TEXT,                      -- storage path in 'models' bucket
  file_size_bytes BIGINT,
  imgsz INT NOT NULL DEFAULT 640,
  num_classes INT NOT NULL,
  labels JSONB NOT NULL,               -- {"0":"closed_eye",...}
  semantic_map JSONB NOT NULL DEFAULT '{}'::jsonb, -- label -> semantic tag
  postprocess_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  precision_score REAL,
  recall_score REAL,
  map50 REAL,
  map50_95 REAL,
  trained_at TIMESTAMPTZ,
  checksum TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);
GRANT SELECT ON public.model_registry TO authenticated;
GRANT ALL ON public.model_registry TO service_role;
ALTER TABLE public.model_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read models" ON public.model_registry
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage models" ON public.model_registry
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_model_registry_updated_at BEFORE UPDATE ON public.model_registry
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed the currently uploaded model
INSERT INTO public.model_registry (
  name, version, engine_kind, head_format, framework,
  file_path, imgsz, num_classes, labels, semantic_map, postprocess_config,
  trained_at, notes, is_active
) VALUES (
  'yolo11m-drowsiness', '1.0.0', 'ultralytics-v8', 'ultralytics-v8', 'onnx',
  'models/best.onnx', 640, 3,
  '{"0":"closed_eye","1":"open_eye","2":"yawning"}'::jsonb,
  '{"closed_eye":"eye_closed","open_eye":"eye_open","yawning":"yawn"}'::jsonb,
  '{"conf_threshold":0.35,"iou_threshold":0.5,"max_detections":100}'::jsonb,
  '2026-06-23T17:18:02Z',
  'Ultralytics YOLO11m, 3 classes, input 640x640, output [1,7,8400]. Seeded from uploaded best.onnx.',
  true
);

-- =========================================================================
-- 6. MEDIA ASSETS
-- =========================================================================
CREATE TABLE public.media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image','video','thumbnail')),
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  duration_sec REAL,
  width INT,
  height INT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_assets_user ON public.media_assets(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO authenticated;
GRANT ALL ON public.media_assets TO service_role;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own media" ON public.media_assets
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Researchers and admins read all media" ON public.media_assets
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','researcher']::public.app_role[]));

-- =========================================================================
-- 7. SESSIONS
-- =========================================================================
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('webcam','video','image')),
  media_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,
  model_id UUID REFERENCES public.model_registry(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,              -- 'browser' | 'remote'
  engine_kind TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_sec REAL,
  frames_processed INT NOT NULL DEFAULT 0,
  avg_fps REAL,
  avg_latency_ms REAL,
  closed_eye_events INT NOT NULL DEFAULT 0,
  yawn_events INT NOT NULL DEFAULT 0,
  perclos REAL,
  risk_score REAL,
  max_risk_level TEXT,
  device_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT
);
CREATE INDEX idx_sessions_user ON public.sessions(user_id, started_at DESC);
CREATE INDEX idx_sessions_source ON public.sessions(source);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated;
GRANT ALL ON public.sessions TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own sessions" ON public.sessions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Researchers and admins read all sessions" ON public.sessions
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','researcher']::public.app_role[]));

-- =========================================================================
-- 8. DETECTION EVENTS
-- =========================================================================
CREATE TABLE public.detection_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  t_ms INT NOT NULL,                   -- ms from session start
  class_id INT NOT NULL,
  class_label TEXT NOT NULL,
  semantic_tag TEXT,                   -- eye_closed | eye_open | yawn | ...
  confidence REAL NOT NULL,
  bbox JSONB NOT NULL,                 -- {x,y,w,h} normalized 0..1
  risk_level TEXT,                     -- normal | warning | drowsy | high_risk
  thumbnail_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_session ON public.detection_events(session_id, t_ms);
CREATE INDEX idx_events_user_time ON public.detection_events(user_id, created_at DESC);
CREATE INDEX idx_events_tag ON public.detection_events(semantic_tag);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.detection_events TO authenticated;
GRANT ALL ON public.detection_events TO service_role;
ALTER TABLE public.detection_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own events" ON public.detection_events
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Researchers and admins read all events" ON public.detection_events
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','researcher']::public.app_role[]));

-- =========================================================================
-- 9. SYSTEM METRICS (admin-only)
-- =========================================================================
CREATE TABLE public.system_metrics (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  cpu_pct REAL,
  gpu_pct REAL,
  ram_mb INT,
  vram_mb INT,
  active_sessions INT,
  queue_len INT,
  avg_latency_ms REAL,
  fps REAL,
  backend_status TEXT,
  db_status TEXT,
  ws_status TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_system_metrics_ts ON public.system_metrics(ts DESC);
GRANT SELECT ON public.system_metrics TO authenticated;
GRANT ALL ON public.system_metrics TO service_role;
ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read system metrics" ON public.system_metrics
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- 10. NOTIFICATIONS
-- =========================================================================
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL = broadcast
  kind TEXT NOT NULL,                  -- 'ai' | 'system' | 'inference' | 'account' | 'rbac'
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error','critical')),
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON public.notifications(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own or broadcast notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users insert own notifications" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins manage notifications" ON public.notifications
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- =========================================================================
-- 11. AUDIT LOG
-- =========================================================================
CREATE TABLE public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT NOT NULL,                -- 'auth.login','settings.update','model.activate','rbac.grant',...
  target_type TEXT,
  target_id TEXT,
  ip INET,
  user_agent TEXT,
  before JSONB,
  after JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_time ON public.audit_log(created_at DESC);
CREATE INDEX idx_audit_actor ON public.audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_action ON public.audit_log(action);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit log" ON public.audit_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own audit rows" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid() OR actor_id IS NULL);

-- =========================================================================
-- 12. AUTH SIGN-UP HANDLER: profile + settings + first-user-becomes-admin
-- =========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  is_first_user BOOLEAN;
  assigned_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_settings (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO is_first_user;
  assigned_role := CASE WHEN is_first_user THEN 'admin'::public.app_role ELSE 'operator'::public.app_role END;

  INSERT INTO public.user_roles (user_id, role, granted_by)
  VALUES (NEW.id, assigned_role, NEW.id)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.audit_log (actor_id, actor_role, action, target_type, target_id, metadata)
  VALUES (NEW.id, assigned_role::text, 'auth.signup', 'user', NEW.id::text,
          jsonb_build_object('email', NEW.email, 'first_user', is_first_user));

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
