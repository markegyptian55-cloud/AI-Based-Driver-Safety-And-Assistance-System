import type { ReactNode } from "react";
import { useRoles, type AppRole } from "@/hooks/use-roles";

type CanProps = {
  role?: AppRole;
  anyOf?: AppRole[];
  fallback?: ReactNode;
  children: ReactNode;
};

/** RBAC UI gate. Server + RLS enforce authoritatively; this hides UI only. */
export function Can({ role, anyOf, fallback = null, children }: CanProps) {
  const { has, hasAny, loading } = useRoles();
  if (loading) return null;
  const ok = (role ? has(role) : false) || (anyOf ? hasAny(anyOf) : false);
  if (!ok) return <>{fallback}</>;
  return <>{children}</>;
}
