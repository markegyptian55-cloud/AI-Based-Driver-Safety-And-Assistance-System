import { useServerFn } from "@tanstack/react-start";
import { recordSignIn } from "@/lib/manager.functions";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Building2, Truck, UserRound } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import {
  IntroVideoBackground,
  WatchFullVideoButton,
} from "@/components/auth/intro-video";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).catch("signin"),
  as: z.enum(["driver", "manager"]).catch("driver"),
  next: z.string().optional().catch(undefined),
});

/**
 * Where a signed-in account belongs. The role card on this page is only a hint:
 * the destination always comes from the account's real fleet role, so a manager
 * never passes through the driver workspace first.
 */
export async function homeForCurrentUser(): Promise<"/manager" | "/live"> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return "/live";
  const { data: member } = await supabase
    .from("org_members")
    .select("role")
    .eq("user_id", uid)
    .maybeSingle();
  return member?.role === "manager" || member?.role === "admin" ? "/manager" : "/live";
}


export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — SentryEye" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async ({ search }) => {
    // If already signed in client-side, bounce to next / the account's real home.
    if (typeof window !== "undefined") {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        throw redirect({ to: (search.next as any) || (await homeForCurrentUser()) });
      }
    }
  },

  component: AuthPage,
});

function AuthPage() {
  const { mode, as, next } = Route.useSearch();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"signin" | "signup">(mode);
  const [intent, setIntent] = useState<"driver" | "manager">(as);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => setTab(mode), [mode]);

  // The card only expresses intent; the destination always comes from the
  // account's real fleet role, so a manager lands on the dashboard directly.
  const logSignIn = useServerFn(recordSignIn);
  const goNext = async () => {
    try {
      await logSignIn({ data: { method: intent } });
    } catch {
      /* audit logging must never block sign-in */
    }
    if (next) {
      navigate({ to: next as any });
      return;
    }

    const home = await homeForCurrentUser();
    if (intent === "manager" && home !== "/manager") {
      toast.info("This account is a driver account", {
        description: "Signed in to the driver workspace instead.",
      });
    }
    navigate({ to: home, replace: true });
  };


  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (tab === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/live` },
        });
        if (error) throw error;
        toast.success("Account created", {
          description: "You're signed in and ready to go.",
        });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
      await goNext();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(
          result.error instanceof Error
            ? result.error.message
            : "Google sign-in failed",
        );
        setLoading(false);
        return;
      }
      if (result.redirected) return; // browser is navigating away
      await goNext();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-8 lg:justify-end lg:px-16">
      <IntroVideoBackground />
      <div className="scanline pointer-events-none absolute inset-0 opacity-30" />
      <div className="relative flex w-full max-w-md flex-col gap-3">
      <Card className="relative w-full border-primary/20 bg-card/80 p-8 backdrop-blur">
        <div className="mb-6 flex items-center gap-2">
          <BrandLogo className="h-8 w-8" />
          <span className="font-mono text-lg font-semibold">SentryEye</span>
        </div>


        <div className="mb-6 space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            I am signing in as
          </p>
          <div className="grid grid-cols-3 gap-2">
            <RoleCard
              icon={<Truck className="h-4 w-4" />}
              label="Driver"
              hint="Live & video"
              active={intent === "driver"}
              onClick={() => setIntent("driver")}
            />
            <RoleCard
              icon={<Building2 className="h-4 w-4" />}
              label="Manager"
              hint="Fleet dashboard"
              active={intent === "manager"}
              onClick={() => setIntent("manager")}
            />
            <RoleCard
              icon={<UserRound className="h-4 w-4" />}
              label="Guest"
              hint="No account"
              active={false}
              onClick={() => navigate({ to: "/live" })}
            />
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-6 space-y-4">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogle}
              disabled={loading}
            >
              <GoogleIcon className="mr-2 h-4 w-4" />
              Continue with Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/60" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 font-mono text-muted-foreground">
                  or email
                </span>
              </div>
            </div>

            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={
                    tab === "signup" ? "new-password" : "current-password"
                  }
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading
                  ? "Working…"
                  : tab === "signup"
                    ? "Create account"
                    : "Sign in"}
              </Button>
            </form>

            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => navigate({ to: "/live" })}
              >
                Continue as guest — try every feature free
              </Button>
              <p className="mt-2 text-center font-mono text-[11px] text-muted-foreground">
                Full live and video detection. Shifts and reports aren't saved
                until you sign in.
              </p>
            </div>

            <p className="text-center font-mono text-[11px] text-muted-foreground">
              {tab === "signup"
                ? "New accounts are always driver accounts. Manager access is issued by the fleet owner."
                : "Signing in takes you to the workspace your account is assigned to."}
            </p>

          </TabsContent>
        </Tabs>
      </Card>
        <WatchFullVideoButton className="w-full" />
      </div>
    </main>
  );
}

function RoleCard({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-center transition-colors ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
      <span className="font-mono text-[10px] opacity-70">{hint}</span>
    </button>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.65 4.1-5.5 4.1-3.3 0-6-2.75-6-6.15S8.7 5.9 12 5.9c1.9 0 3.15.8 3.87 1.5l2.63-2.55C16.87 3.35 14.65 2.4 12 2.4 6.75 2.4 2.5 6.65 2.5 12s4.25 9.6 9.5 9.6c5.5 0 9.15-3.85 9.15-9.3 0-.62-.07-1.1-.16-1.6H12z"
      />
    </svg>
  );
}
