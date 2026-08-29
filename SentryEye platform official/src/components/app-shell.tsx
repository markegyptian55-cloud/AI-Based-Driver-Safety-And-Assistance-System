import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Video,
  Film,
  History,
  FileText,
  BarChart3,
  Brain,
  Activity,
  Settings,
  User as UserIcon,
  Bell,
  BellOff,
  LogOut,
  Eye,
  CheckCheck,
  Gauge,
  HardDrive,
  CloudOff,
  RefreshCw,
  ShieldCheck,
  Building2,
  Users,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ErrorBoundary } from "@/components/error-boundary";
import { ModelStatusPill } from "@/components/model-selector";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRoles, type AppRole } from "@/hooks/use-roles";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useShift } from "@/features/fleet/shift-context";
import { BrandLogo } from "@/components/brand-logo";
import { errorMessage } from "@/lib/format-error";
import { APP_VERSION } from "@/lib/app-version";
import type { ReactNode } from "react";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: AppRole[];
};

const driverNav: NavItem[] = [
  { to: "/live", label: "Live detection", icon: Video },
  { to: "/video", label: "Video detection", icon: Film },
  { to: "/models", label: "Offline models", icon: HardDrive },
  { to: "/my-report", label: "My report", icon: ShieldCheck },
];

const managerNav: NavItem[] = [
  { to: "/manager", label: "Fleet dashboard", icon: Building2 },
  { to: "/manager/drivers", label: "Drivers", icon: Users },
  { to: "/manager/history", label: "History", icon: History },
  { to: "/manager/audit", label: "Activity log", icon: FileText },
];


// Technical / research surfaces stay available to admins only so neither the
// driver nor the manager view is cluttered with engine tooling.
const adminNav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/model", label: "AI model info", icon: Brain },
  { to: "/report", label: "Driver report", icon: FileText },
  { to: "/history", label: "Session history", icon: History },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/benchmark", label: "Engine benchmark", icon: Gauge },
  { to: "/monitoring", label: "System status", icon: Activity },
];

/** Detection/engine surfaces a manager account must never land on. */
const DETECTION_PATHS: string[] = ["/live", "/video", "/image", "/models", "/model", "/benchmark"];

const accountNav: NavItem[] = [
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/profile", label: "Profile", icon: UserIcon },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { hasAny, roles } = useRoles();
  const {
    isManager,
    identityLoading,
    pendingCount,
    active: shiftActive,
    endShift,
  } = useShift();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [signingOut, setSigningOut] = useState(false);

  const email = user?.email ?? "";
  const initials = (email[0] ?? "?").toUpperCase();
  const topRole = (roles[0] ?? "viewer").toString();

  const groups = useMemo(() => {
    const isAdmin = hasAny(["admin"]);
    if (isManager) {
      return [
        { label: "Fleet", items: managerNav },
        ...(isAdmin ? [{ label: "System", items: adminNav }] : []),
        { label: "Account", items: accountNav },
      ];
    }
    return [
      { label: "Driving", items: driverNav },
      ...(isAdmin ? [{ label: "System", items: adminNav }] : []),
      ...(user ? [{ label: "Account", items: accountNav }] : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles.join(","), isManager, !!user]);

  // UX-only routing: the database RLS policies remain the real boundary.
  useEffect(() => {
    if (identityLoading) return;
    if (!isManager && pathname.startsWith("/manager")) {
      navigate({ to: "/live", replace: true });
      return;
    }
    // A manager never runs detection, so engine/model surfaces are pointless
    // noise (and would trigger GPU probing + model downloads on their device).
    if (isManager && DETECTION_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      navigate({ to: "/manager", replace: true });
    }
  }, [identityLoading, isManager, pathname, navigate]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Leaving the app ends the shift: the report is built (and queued when
      // offline) before the session is torn down, so nothing is lost.
      if (shiftActive) {
        try {
          const report = await endShift();
          if (report) {
            toast.success(
              report.sync === "synced"
                ? "Shift finalized — sent to your manager's dashboard"
                : "Shift finalized — saved offline, will sync automatically",
            );
          }
        } catch (e) {
          toast.error(errorMessage(e));
        }
      }
      await queryClient.cancelQueries();
      queryClient.clear();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      toast.success("Signed out");
      navigate({ to: "/auth", search: { mode: "signin" }, replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          <CloseOnNavLink to={isManager ? "/manager" : "/live"} className="flex items-center gap-2 px-2 py-1">
            <BrandLogo className="h-6 w-6" />
            <span className="font-mono text-sm font-semibold group-data-[collapsible=icon]:hidden">
              SentryEye
            </span>
          </CloseOnNavLink>
        </SidebarHeader>

        <SidebarContent>
          {groups.map((g) => (
            <NavGroup key={g.label} label={g.label} items={g.items} pathname={pathname} />
          ))}
        </SidebarContent>

        <SidebarFooter>
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            <span className="h-1.5 w-1.5 rounded-full bg-safe" aria-hidden="true" />
            <CloseOnNavLink to="/monitoring" className="font-mono hover:text-foreground">
              v{APP_VERSION} · status
            </CloseOnNavLink>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger />
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {pathname.replace("/", "") || "dashboard"}
            </span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            <OfflineBadge pendingCount={pendingCount} />
            {isManager ? null : <ModelStatusPill className="hidden md:inline-flex" />}
            <Badge
              variant="outline"
              className="hidden font-mono text-[10px] uppercase sm:inline-flex"
            >
              {user ? topRole : "visitor"}
            </Badge>
            {user ? (
              <>
                <NotificationCenter userId={user.id} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="gap-2 px-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="bg-primary/20 text-xs font-semibold text-primary">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="hidden text-sm md:inline">{email}</span>
                      <span className="sr-only">Account menu</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => navigate({ to: "/profile" })}>
                      <UserIcon className="mr-2 h-4 w-4" aria-hidden="true" /> Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
                      <Settings className="mr-2 h-4 w-4" aria-hidden="true" /> Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={handleSignOut}
                      disabled={signingOut}
                      className="text-destructive"
                    >
                      <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                      {signingOut ? "Signing out…" : "Sign out"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Button
                size="sm"
                onClick={() => navigate({ to: "/auth", search: { mode: "signin" } })}
              >
                Sign in
              </Button>
            )}
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="p-4 sm:p-6 focus:outline-none">
          {!user ? (
            <div className="mb-4 flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="text-muted-foreground">
                <span className="font-mono text-xs uppercase tracking-wider text-primary">
                  Visitor mode
                </span>{" "}
                — detection runs fully. Sign in to save sessions, history and reports.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => navigate({ to: "/auth", search: { mode: "signup" } })}
              >
                Create free account
              </Button>
            </div>
          ) : null}
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>

      </SidebarInset>
    </SidebarProvider>
  );
}

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  created_at: string;
  read_at: string | null;
}

function NotificationCenter({ userId }: { userId: string | undefined }) {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<NotificationRow[]>({
    queryKey: ["notifications", userId],
    enabled: !!userId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id,title,body,severity,created_at,read_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as NotificationRow[];
    },
  });

  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  const markAllRead = useMutation({
    mutationFn: async () => {
      const ids = items.filter((n) => !n.read_at).map((n) => n.id);
      if (!ids.length) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", userId] }),
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Notifications</span>
          {unread > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                markAllRead.mutate();
              }}
              disabled={markAllRead.isPending}
              className="inline-flex items-center gap-1 rounded px-1 font-mono text-[10px] uppercase text-primary hover:underline disabled:opacity-50"
            >
              <CheckCheck className="h-3 w-3" aria-hidden="true" />
              {markAllRead.isPending ? "Marking…" : "Mark all read"}
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isLoading ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="px-2 py-6 text-center text-sm text-destructive">
            Couldn't load notifications
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-sm text-muted-foreground">
            <BellOff className="h-5 w-5" aria-hidden="true" />
            <span>No notifications</span>
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <ul>
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`border-b border-border/40 px-3 py-2 last:border-0 ${
                    n.read_at ? "opacity-70" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug">{n.title}</p>
                    <Badge
                      variant="outline"
                      className={`shrink-0 font-mono text-[9px] uppercase ${
                        n.severity === "critical" || n.severity === "error"
                          ? "border-destructive/40 text-destructive"
                          : n.severity === "warning"
                            ? "border-warning/40 text-warning"
                            : "text-muted-foreground"
                      }`}
                    >
                      {n.severity}
                    </Badge>
                  </div>
                  {n.body ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                  ) : null}
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavGroup({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  const { setOpenMobile } = useSidebar();
  if (items.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-wider">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = pathname === item.to;
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                  <Link to={item.to as any} onClick={() => setOpenMobile(false)}>
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** A sidebar link that closes the mobile drawer as soon as it is tapped. */
function CloseOnNavLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <Link to={to as any} className={className} onClick={() => setOpenMobile(false)}>
      {children}
    </Link>
  );
}

/**
 * Connectivity indicator. Offline is normal for this app — detection keeps
 * running on-device — so it reads as information, not an error. Any shifts
 * still waiting to reach the cloud are shown here too.
 */
function OfflineBadge({ pendingCount }: { pendingCount: number }) {
  const online = useOnlineStatus();
  if (online && pendingCount === 0) return null;
  return (
    <Badge
      variant="outline"
      className={
        online
          ? "gap-1 border-primary/40 font-mono text-[10px] uppercase text-primary"
          : "gap-1 border-amber-500/50 font-mono text-[10px] uppercase text-amber-400"
      }
      title={
        online
          ? "Waiting to sync completed shifts"
          : "You're offline — detection still runs on this device"
      }
    >
      {online ? (
        <RefreshCw className="h-3 w-3" aria-hidden="true" />
      ) : (
        <CloudOff className="h-3 w-3" aria-hidden="true" />
      )}
      {online ? `${pendingCount} to sync` : "Offline"}
      {!online && pendingCount > 0 ? ` · ${pendingCount} queued` : ""}
    </Badge>
  );
}
