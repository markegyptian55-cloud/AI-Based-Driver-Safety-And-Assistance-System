// Shareable, expiring diagnostics links.
//
// The bundle is redacted on the device before it ever reaches this file (see
// diagnostics-redact.ts). Here we only mint an unguessable token, store the
// already-redacted payload with a hard expiry, and hand it back by token.
//
// Reads go through the privileged client on purpose: the token is the only
// credential, so the table itself must never be readable through the Data API.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MAX_PAYLOAD_BYTES = 1_500_000;
const TTL_CHOICES = [3600, 21600, 86400, 604800] as const;

const createSchema = z.object({
  payload: z.unknown(),
  redaction: z.array(z.string()).max(50).default([]),
  ttlSeconds: z
    .number()
    .int()
    .refine((v) => (TTL_CHOICES as readonly number[]).includes(v), "Unsupported expiry"),
});

function mintToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const createDiagnosticsShare = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data }) => {
    const serialized = JSON.stringify(data.payload ?? {});
    if (serialized.length > MAX_PAYLOAD_BYTES) {
      throw new Error("Diagnostics bundle is too large to share. Download it instead.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Opportunistic housekeeping — expired links must not linger in storage.
    await supabaseAdmin.rpc("purge_expired_diagnostics_shares");

    const token = mintToken();
    const expiresAt = new Date(Date.now() + data.ttlSeconds * 1000).toISOString();

    const { error } = await supabaseAdmin.from("diagnostics_shares").insert({
      token,
      payload: JSON.parse(serialized),
      redaction_summary: data.redaction,
      expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);

    return { token, expiresAt };
  });

const readSchema = z.object({ token: z.string().regex(/^[0-9a-f]{48}$/, "Invalid link") });

export const readDiagnosticsShare = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => readSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("diagnostics_shares")
      .select("payload, redaction_summary, created_at, expires_at, view_count")
      .eq("token", data.token)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) return { status: "missing" as const };
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await supabaseAdmin.from("diagnostics_shares").delete().eq("token", data.token);
      return { status: "expired" as const };
    }

    await supabaseAdmin
      .from("diagnostics_shares")
      .update({ view_count: (row.view_count ?? 0) + 1 })
      .eq("token", data.token);

    return {
      status: "ok" as const,
      payload: row.payload,
      redaction: row.redaction_summary ?? [],
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  });
