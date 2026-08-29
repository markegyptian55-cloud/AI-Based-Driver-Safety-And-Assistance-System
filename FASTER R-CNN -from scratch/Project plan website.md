
# AI-Based Driver Drowsiness Detection — Architecture Blueprint

This is a **design-only** document. No code, SQL, or components will be generated until you approve.

---

## 1. High-Level Architecture

Three independent tiers communicating over HTTPS/WSS:

```text
 ┌───────────────────────────┐        ┌────────────────────────────┐        ┌──────────────────────────────┐
 │  FRONTEND (Lovable)       │        │  AI BACKEND (FastAPI)      │        │  DATA PLANE (Lovable Cloud   │
 │  React + TanStack Start   │        │  Python + PyTorch + OpenCV │        │  / Supabase)                 │
 │                           │        │                            │        │                              │
 │  - Webcam / Dashcam       │◀──WSS─▶│  - YOLO best.pt inference  │        │  - Postgres (users, sessions,│
 │  - Video / Image upload   │──HTTPS▶│  - EAR / MAR / Head pose   │        │    events, alerts, logs)     │
 │  - Live dashboard         │        │  - Fatigue scoring engine  │◀─REST─▶│  - Auth (email + Google)     │
 │  - Admin analytics        │        │  - Alert decision engine   │        │  - Storage (videos/images)   │
 │  - Alert UI + sound       │        │  - Notification dispatcher │        │  - RLS policies              │
 └─────────────┬─────────────┘        └───────────┬────────────────┘        └──────────────┬───────────────┘
               │                                  │                                        │
               │            Supabase JWT          │       Service-role key (server only)   │
               └──────────────────────────────────┴────────────────────────────────────────┘
                                                  │
                            ┌─────────────────────┴─────────────────────┐
                            │  External providers                       │
                            │  SMTP/Resend (email) · Twilio (WhatsApp) │
                            └───────────────────────────────────────────┘
```

**Why this split:** Lovable cannot host PyTorch/OpenCV. Keeping AI in a separate FastAPI service lets each tier scale independently, keeps the model file off the browser, and lets the frontend stay a thin, fast client.

---

## 2. Data Flow

### 2A. Live webcam / dashcam
```text
Browser camera → getUserMedia → frame sampled @ ~10 fps
   → WebSocket frame (JPEG/base64) → FastAPI /ws/detect
   → YOLO inference on best.pt → EAR/MAR/head pose calc
   → fatigue scoring engine (rolling window)
   → JSON event {state, ear, mar, score, alert_level} → browser
   → if alert_level ≥ threshold:
        · UI alarm + sound
        · FastAPI writes event → Supabase
        · FastAPI dispatches email / WhatsApp (async)
```

### 2B. Uploaded video/image
```text
Browser → Supabase Storage (signed upload) → returns file path
Browser → POST /jobs {file_path, type} → FastAPI enqueues job
FastAPI worker downloads from Storage → runs detection frame-by-frame
   → writes session + events → Postgres
   → marks job complete → frontend polls / subscribes → renders report
```

**Why WebSocket for live, REST for jobs:** live needs sub-second bidirectional streaming; batch jobs are long-running and better modeled as async REST + status polling.

---

## 3. Folder Structure

### Frontend (Lovable, TanStack Start)
```text
src/
  routes/
    index.tsx                 # marketing / demo entry
    auth.tsx                  # login / signup
    _authenticated/
      route.tsx               # auth gate
      dashboard.tsx           # live detection
      history.tsx             # past sessions
      sessions.$id.tsx        # session detail
      upload.tsx              # video/image upload
      admin/
        route.tsx             # admin-only gate
        users.tsx
        analytics.tsx
        alerts.tsx
        settings.tsx
    api/public/               # webhooks only
  components/
    detection/                # VideoStream, MetricsPanel, AlertBanner
    charts/                   # EAR/MAR/score charts
    admin/
    ui/                       # shadcn primitives
  lib/
    detection-client.ts       # WS + REST client to FastAPI
    supabase/                 # generated client
  hooks/                      # useWebcam, useDetectionSession, useAlerts
  styles.css
```

### AI Backend (FastAPI)
```text
backend/
  app/
    main.py                   # FastAPI entry
    api/
      routes_detect.py        # /detect/image, /detect/video
      routes_ws.py            # /ws/detect (live stream)
      routes_jobs.py          # /jobs upload processing
      routes_health.py
    core/
      config.py               # env, secrets
      security.py             # JWT verification (Supabase)
      logging.py
    ml/
      model_loader.py         # loads best.pt once at startup
      inference.py            # YOLO forward pass
      landmarks.py            # eye/mouth landmark extraction
      metrics.py              # EAR, MAR, head pose
      fatigue_engine.py       # rolling-window scoring, state machine
    services/
      supabase_client.py      # service-role client
      storage.py              # signed uploads/downloads
      notifications/
        email.py
        whatsapp.py
        dispatcher.py         # decides which channels to fire
    workers/
      video_worker.py         # async video job runner
    schemas/                  # Pydantic models
    utils/
  models/
    best.pt
  tests/
  Dockerfile
  requirements.txt
```

**Why:** clean separation between HTTP layer, ML core, and integrations; makes the ML swappable and testable in isolation.

---

## 4. Frontend Component Hierarchy

```text
RootLayout (providers, theme)
└─ AuthenticatedLayout (session gate, nav)
   ├─ DashboardPage
   │   ├─ SourceSelector (Webcam | Dashcam | Upload)
   │   ├─ VideoStream (MediaStream + canvas overlay)
   │   ├─ DetectionOverlay (boxes, landmarks)
   │   ├─ MetricsPanel (EAR, MAR, closure duration, yawns, score)
   │   ├─ StateBadge (Awake / Drowsy / Sleeping)
   │   ├─ AlertBanner + AlarmSound
   │   └─ SessionTimeline (live event stream)
   ├─ UploadPage
   │   ├─ FileDropzone → Supabase Storage
   │   └─ JobStatus → results view
   ├─ HistoryPage → SessionList → SessionDetail (charts + events)
   └─ AdminLayout (role-gated)
       ├─ UsersTable
       ├─ AnalyticsDashboard (aggregate charts)
       ├─ AlertsLog
       └─ ModelSettings (thresholds, notification channels)
```

---

## 5. Backend Architecture (FastAPI)

**Layers**
- **Transport:** FastAPI routers (REST) + a WebSocket endpoint for live frames.
- **Auth:** dependency that validates Supabase JWT (JWKS) on every request; extracts user id + role.
- **ML core:** singleton model loaded once at process start; a stateless `predict(frame)` function; per-connection `FatigueEngine` instance holding the rolling window and state machine.
- **Persistence:** thin repository layer that talks to Supabase via the service-role key (server-only) — never exposed to the browser.
- **Notifications:** dispatcher pattern; each channel (email, WhatsApp) is a pluggable adapter with retry + rate-limiting.
- **Workers:** background task runner (FastAPI `BackgroundTasks` initially; upgradeable to Celery/RQ + Redis when load grows) for uploaded-video processing.

**Why FastAPI:** async-first (great for WebSockets), Pydantic validation, OpenAPI docs, and native Python so PyTorch/OpenCV work natively.

---

## 6. Frontend Architecture (Lovable / TanStack Start)

- **Routing:** file-based; `_authenticated/` subtree gated by Supabase session; `_authenticated/admin/` further gated by role check via `has_role` RPC.
- **Data:** TanStack Query for REST (sessions, history, admin lists). WebSocket managed by a dedicated hook (`useLiveDetection`) that pushes frames and consumes events into a Zustand/Context store for the live panel.
- **Media:** `getUserMedia` for webcam; `<input type=file>` for uploads that go directly to Supabase Storage (signed URL) — frontend never proxies large blobs through FastAPI.
- **Alerts UI:** in-app banner + Web Audio API alarm; visual state driven by backend `alert_level`.

---

## 7. Database Architecture (Supabase / Postgres)

**Tables (conceptual, not SQL):**
- `profiles` — 1:1 with `auth.users`; display name, phone, notification prefs.
- `user_roles` — separate table (guest / admin) with `app_role` enum; checked via `has_role` SECURITY DEFINER function to prevent privilege escalation.
- `detection_sessions` — one row per live session or processed upload; source type, start/end, aggregate stats, status.
- `detection_events` — high-frequency rows: timestamp, session_id, state, ear, mar, head_pose, score, alert_level.
- `uploaded_media` — metadata for videos/images in Storage (path, mime, duration, size).
- `alerts` — every fired alert: channel, recipient, payload, delivery status.
- `notification_settings` — per-user thresholds and channels.
- `model_settings` — admin-tunable thresholds (EAR, MAR, closure duration).
- `audit_logs` — admin actions and security-relevant events.
- `statistics_daily` — pre-aggregated rollups for analytics performance.

**RLS strategy:**
- Users see only their own sessions/events/media/alerts.
- Admins see all via `has_role(auth.uid(),'admin')`.
- Writes from FastAPI use service-role key (bypasses RLS) — the API itself enforces ownership.

**Why separate `detection_events` from `sessions`:** events are write-heavy and time-series-shaped; keeping them isolated allows indexing by `(session_id, ts)` and partitioning later.

---

## 8. Storage Architecture (Supabase Storage)

Buckets:
- `uploads-videos` (private) — user uploads for batch processing.
- `uploads-images` (private) — user uploaded images.
- `session-clips` (private) — optional short clips saved when an alert fires.
- `avatars` (public) — profile pictures.

Access via **signed URLs** with short TTL. FastAPI downloads from Storage using the service-role key for processing; results (metadata) go to Postgres, not back into Storage unless a clip is retained.

---

## 9. Authentication Architecture

- **Provider:** Supabase Auth (email/password + Google) via Lovable Cloud.
- **Session:** JWT in browser (Supabase client). Frontend attaches bearer to FastAPI calls and WebSocket handshake (`Authorization` header or `?token=` on WS).
- **Backend verification:** FastAPI validates the JWT against Supabase JWKS on every request; extracts `sub` (user id) and role claim; role is re-checked via `has_role` for admin routes.
- **Guest mode:** anonymous demo — no persistence beyond a session-scoped in-memory record; upgrade path to real account preserves recent history.
- **Never** store roles on `profiles`; always via `user_roles` + SECURITY DEFINER function.

---

## 10. REST + WebSocket API Design (surface only)

**Public**
- `GET /health`
- `POST /demo/detect-image` (guest, rate-limited)

**Authenticated**
- `POST /detect/image` — single image inference
- `POST /jobs/video` — start batch processing of an uploaded video
- `GET  /jobs/{id}` — job status + result summary
- `GET  /sessions` / `GET /sessions/{id}` / `GET /sessions/{id}/events`
- `GET  /alerts`
- `PUT  /me/notification-settings`
- `WS   /ws/detect` — bidirectional live stream (frames in, events out)

**Admin**
- `GET /admin/users` · `PATCH /admin/users/{id}/role`
- `GET /admin/analytics/summary`
- `GET /admin/alerts`
- `PUT /admin/model-settings`

**Conventions:** JSON, ISO-8601 timestamps, cursor pagination, standard error envelope, per-user rate limits, OpenAPI auto-docs at `/docs`.

---

## 11. Deployment Architecture

```text
Frontend  → Lovable hosting (edge)
Database  → Lovable Cloud (Supabase-managed Postgres + Auth + Storage)
Backend   → Containerized FastAPI on a GPU-capable host
             Options: Render / Fly.io / Railway (CPU) · RunPod / Lambda Labs / AWS g5 (GPU)
             · Dockerized, health-checked, autoscaled
             · Secrets from platform env (no .env in repo)
             · Reverse proxy with HTTPS + WSS
Model     → best.pt baked into the container image (versioned tag)
Notifs    → Resend/SMTP for email · Twilio for WhatsApp
Observability → Sentry (frontend + backend) · platform logs · uptime monitor
```

**Why separate hosting for FastAPI:** Lovable runs Edge Workers; PyTorch/OpenCV need Python + optionally CUDA — they cannot run on Cloudflare Workers.

---

## 12. Security

- HTTPS + WSS everywhere; HSTS.
- Supabase JWT verification on every FastAPI call; role checks via `has_role`.
- Service-role key **only** in FastAPI env — never shipped to browser.
- RLS on every user-facing table; grants explicit per role.
- Signed URLs for storage; private buckets by default.
- Input validation via Pydantic; strict file-type/size limits on uploads; virus/mime sniffing.
- Per-IP and per-user rate limits on guest and auth endpoints.
- CORS allowlist for the Lovable domain.
- Secrets rotation; audit log for admin actions.
- PII minimization; encrypt phone numbers at rest (optional pgcrypto).
- No storing frames long-term unless the user consents (privacy).

---

## 13. Scalability

- Stateless FastAPI → horizontal scale behind a load balancer.
- Sticky sessions for WebSockets (or a Redis pub/sub if we need cross-node fan-out).
- Model loaded once per worker; use `uvicorn --workers N` sized to GPU/CPU.
- Move batch video jobs to a queue (Redis + RQ/Celery) when concurrency > a few.
- Postgres: index `detection_events(session_id, ts)`; partition by month once large; pre-aggregate into `statistics_daily`.
- CDN for frontend assets (Lovable default).
- Autoscale GPU workers based on queue depth.

---

## 14. Performance

- Sample frames client-side at 8–12 fps, not 30 — big win, minimal accuracy loss.
- Downscale frames to model input size before sending (e.g. 640×640).
- Send JPEG (quality ~70) over WS instead of raw pixels.
- Reuse the same WS connection per session; avoid reconnect churn.
- Batch inference where possible for uploaded videos.
- Half-precision (fp16) on GPU; ONNX/TensorRT export as a later optimization.
- Debounce metric updates in the UI to ~5 Hz to avoid React re-render storms.
- Use `requestAnimationFrame` for overlay drawing on `<canvas>`.

---

## 15. Risks & Mitigation

| Risk | Mitigation |
|---|---|
| GPU cost | Start CPU-only for demo; add GPU worker only for heavy loads; autoscale to zero when idle. |
| Latency spikes over WS | Adaptive frame rate; drop frames client-side when backpressure detected. |
| Model false positives → alarm fatigue | Rolling-window scoring + hysteresis in state machine; user-tunable thresholds. |
| Privacy of camera feeds | Do not persist frames by default; explicit consent for clip retention; short TTL on any stored media. |
| Notification abuse / cost (Twilio) | Per-user rate limits + cooldown between alerts of same type. |
| Browser camera permission denied | Clear UX fallback: upload flow always available. |
| FastAPI single-point-of-failure | Health checks + multi-instance deploy; graceful WS reconnect on client. |
| Supabase RLS misconfig | Migration review checklist; automated policy tests. |
| best.pt version drift | Version the model file; store hash + version in `model_settings`; log per session. |
| Guest abuse of demo | Aggressive rate-limit + captcha on demo endpoint. |

---

## 16. Development Roadmap

**Phase 0 — Foundations (setup)**
- Repos: `frontend` (Lovable) + `backend` (FastAPI).
- Enable Lovable Cloud (Auth + DB + Storage).
- CI, linting, Sentry, environment matrices (dev/prod).

**Phase 1 — Backend MVP**
- FastAPI skeleton, load `best.pt`, `/detect/image` endpoint.
- EAR/MAR/head-pose calculators + unit tests on sample frames.
- Fatigue engine + state machine with configurable thresholds.

**Phase 2 — Database & Auth**
- Design + migrate schema (profiles, roles, sessions, events, alerts, media, settings, logs).
- RLS policies + `has_role` function + policy tests.
- Supabase JWT verification middleware in FastAPI.

**Phase 3 — Frontend MVP**
- Auth flows (email + Google), authenticated layout, role gate.
- Webcam capture + `/detect/image` round-trip proof of concept.
- Metrics panel + state badge + alarm sound.

**Phase 4 — Live streaming**
- WebSocket `/ws/detect` end-to-end.
- Live overlay canvas, timeline, alert banner.
- Session persistence (start/stop, events written).

**Phase 5 — Uploads**
- Signed upload to Supabase Storage from browser.
- `/jobs/video` batch worker + status polling.
- Session detail view with charts.

**Phase 6 — Alerts & Notifications**
- Email (Resend/SMTP) + WhatsApp (Twilio) adapters.
- Notification preferences UI + cooldown logic.

**Phase 7 — Admin**
- Users table + role management.
- Analytics dashboard (daily rollups).
- Alerts log + model settings.

**Phase 8 — Hardening**
- Rate limits, CORS, audit logs, security review.
- Load test WS + batch pipeline.
- Perf: fp16, frame downscaling, UI debouncing.

**Phase 9 — Deployment & Handover**
- Dockerize FastAPI, deploy to chosen host, HTTPS/WSS.
- Publish frontend on Lovable.
- Runbook, monitoring, backup policy, thesis documentation.

---

## 17. Why these choices (summary of rationale)

- **Split frontend from AI backend:** PyTorch cannot run in Lovable's edge runtime; separation also isolates GPU cost and lets each side scale independently.
- **FastAPI:** async WebSockets + Pydantic + native Python for ML — the ideal fit.
- **Supabase (Lovable Cloud):** turnkey Auth + Postgres + Storage + RLS; no ops overhead for a graduation project, production-grade for later.
- **WebSocket for live, REST for jobs:** matches the shape of each workload.
- **Roles in a separate table + SECURITY DEFINER function:** the only safe pattern; prevents privilege escalation.
- **Signed URLs + private buckets:** protects sensitive footage without proxying large files through the API.
- **Rolling-window fatigue engine with hysteresis:** avoids alarm flicker from single-frame noise.
- **File-based routing with an `_authenticated/` gate:** matches the TanStack Start template and keeps auth enforcement structural, not ad-hoc.
- **Pre-aggregated `statistics_daily`:** keeps admin analytics fast as event volume grows.
- **Docker + autoscaling GPU workers:** keeps cost near zero when idle, scales when demonstrated.

---

Awaiting your approval. Once you confirm, I'll begin **Phase 0 → Phase 1** and check in after each phase before continuing.
