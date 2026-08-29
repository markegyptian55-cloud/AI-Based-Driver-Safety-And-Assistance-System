import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export type AppRole = "admin" | "researcher" | "operator" | "viewer";

/**
 * Reads the current user's roles from public.user_roles.
 * Reads run under RLS; users can only read their own rows.
 */
export function useRoles() {
  const { user, loading: authLoading } = useAuth();

  const query = useQuery({
    queryKey: ["user_roles", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<AppRole[]> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
    staleTime: 60_000,
  });

  const roles = query.data ?? [];
  const has = (role: AppRole) => roles.includes(role);
  const hasAny = (list: AppRole[]) => list.some((r) => roles.includes(r));

  return {
    roles,
    loading: authLoading || query.isLoading,
    isAdmin: has("admin"),
    isResearcher: has("researcher"),
    isOperator: has("operator"),
    isViewer: has("viewer"),
    has,
    hasAny,
  };
}
