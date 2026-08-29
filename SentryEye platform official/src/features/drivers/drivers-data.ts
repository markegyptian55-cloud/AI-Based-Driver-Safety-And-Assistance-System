// Driver identity records. Each signed-in account owns its own driver roster;
// visitors never touch the database and use a local label instead.

import { supabase } from "@/integrations/supabase/client";

export interface Driver {
  id: string;
  fullName: string;
  driverCode: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

function mapRow(row: Record<string, unknown>): Driver {
  return {
    id: String(row["id"]),
    fullName: (row["full_name"] as string | null) ?? "Driver",
    driverCode: (row["driver_code"] as string | null) ?? "-",
    notes: (row["notes"] as string | null) ?? null,
    isActive: Boolean(row["is_active"]),
    createdAt: String(row["created_at"]),
  };
}

export async function fetchDrivers(): Promise<Driver[]> {
  const { data, error } = await supabase
    .from("drivers")
    .select("id,full_name,driver_code,notes,is_active,created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => mapRow(r as unknown as Record<string, unknown>));
}

export async function createDriver(input: {
  userId: string;
  fullName: string;
  driverCode: string;
  notes?: string | null;
}): Promise<Driver> {
  const { data, error } = await supabase
    .from("drivers")
    .insert({
      user_id: input.userId,
      full_name: input.fullName,
      driver_code: input.driverCode,
      notes: input.notes ?? null,
    })
    .select("id,full_name,driver_code,notes,is_active,created_at")
    .single();
  if (error) throw error;
  return mapRow(data as unknown as Record<string, unknown>);
}

export async function deleteDriver(id: string): Promise<void> {
  const { error } = await supabase.from("drivers").delete().eq("id", id);
  if (error) throw error;
}

/** Display form used on reports and PDFs: "D-014 · Ahmed". */
export function driverDisplayLabel(d: Driver): string {
  return `${d.driverCode} · ${d.fullName}`;
}
