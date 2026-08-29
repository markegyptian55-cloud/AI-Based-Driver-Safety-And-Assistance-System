// Server-side manager guard and audit feed.
//
// The manager surface is locked to a single reserved account. The browser
// redirect is UX only — this module is the security boundary: every manager
// read runs through `requireManager`, which resolves the caller's email from
// the verified bearer token (never from client input) and refuses anything
// else with a 403. Allowed and denied attempts are both written to the audit
// log using the verified identity.

import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const RESERVED_MANAGER_EMAIL = "markegyptian55@gmail.com";

export const requireManager = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const claims = context.claims as { email?: string } | undefined;
    let email = typeof claims?.email === "string" ? claims.email : null;
    if (!email) {
      const { data } = await context.supabase.auth.getUser();
      email = data.user?.email ?? null;
    }
    const allowed = (email ?? "").toLowerCase() === RESERVED_MANAGER_EMAIL;

    await context.supabase.from("audit_log").insert({
      actor_id: context.userId,
      actor_role: allowed ? "manager" : "driver",
      action: allowed ? "manager.access_granted" : "manager.access_denied",
      target_type: "manager_dashboard",
      metadata: { email },
    });

    if (!allowed) {
      throw new Response("Forbidden: manager access is restricted", { status: 403 });
    }
    return next({ context: { managerEmail: email as string } });
  });

/** Cheap yes/no probe the client uses to decide whether to render /manager. */
export const checkManagerAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const claims = context.claims as { email?: string } | undefined;
    let email = typeof claims?.email === "string" ? claims.email : null;
    if (!email) {
      const { data } = await context.supabase.auth.getUser();
      email = data.user?.email ?? null;
    }
    return { allowed: (email ?? "").toLowerCase() === RESERVED_MANAGER_EMAIL, email };
  });

export interface AuditFeedRow {
  id: number;
  createdAt: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export const fetchAuditFeed = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(
    (input: {
      limit?: number;
      offset?: number;
      action?: string | null;
      from?: string | null;
      to?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("manager_audit_feed", {
      _limit: Math.min(Math.max(data.limit ?? 50, 1), 200),
      _offset: Math.max(data.offset ?? 0, 0),
      _action: data.action ?? undefined,
      _from: data.from ?? undefined,
      _to: data.to ?? undefined,
    });
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as Array<Record<string, unknown>>;
    const items: AuditFeedRow[] = list.map((r) => ({
      id: Number(r["id"] ?? 0),
      createdAt: String(r["created_at"] ?? ""),
      action: String(r["action"] ?? ""),
      actorId: (r["actor_id"] as string | null) ?? null,
      actorEmail: (r["actor_email"] as string | null) ?? null,
      actorRole: (r["actor_role"] as string | null) ?? null,
      targetType: (r["target_type"] as string | null) ?? null,
      targetId: (r["target_id"] as string | null) ?? null,
      metadata: (r["metadata"] as Record<string, string | number | boolean | null>) ?? {},
    }));
    const total = list.length ? Number(list[0]!["total_count"] ?? items.length) : 0;
    return { items, total };
  });

/** Records that the manager dashboard pulled fresh data. */
export const recordDashboardRefresh = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: { manual?: boolean } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    await context.supabase.from("audit_log").insert({
      actor_id: context.userId,
      actor_role: "manager",
      action: "manager.dashboard_refresh",
      target_type: "manager_dashboard",
      metadata: { manual: data.manual ?? false },
    });
    return { ok: true };
  });

/** Records a successful sign-in for any account. */
export const recordSignIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { method?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const claims = context.claims as { email?: string } | undefined;
    await context.supabase.from("audit_log").insert({
      actor_id: context.userId,
      action: "auth.signin",
      target_type: "user",
      target_id: context.userId,
      metadata: { method: data.method ?? "password", email: claims?.email ?? null },
    });
    return { ok: true };
  });
