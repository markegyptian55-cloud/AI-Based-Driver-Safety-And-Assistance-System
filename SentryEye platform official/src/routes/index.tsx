import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { homeForCurrentUser } from "./auth";

import { useEffect, useState } from "react";
import { Eye, ShieldCheck, Activity, Cpu, LineChart, PlayCircle } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SentryEye — Real-time AI Driver Drowsiness Detection" },
      {
        name: "description",
        content:
          "On-device YOLO inference detects closed eyes and yawning in real time. Live dashboard, session reports, and analytics for safety-critical operations.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  const navigate = useNavigate();

  // A signed-in account never needs the marketing page: send it straight to the
  // workspace its fleet role belongs to (manager → dashboard, driver → live).
  useEffect(() => {
    let cancelled = false;
    const route = async (hasSession: boolean) => {
      if (cancelled) return;
      setSignedIn(hasSession);
      if (!hasSession) return;
      const home = await homeForCurrentUser();
      if (!cancelled) navigate({ to: home, replace: true });
    };
    supabase.auth.getSession().then(({ data }) => void route(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => void route(!!s));
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);


  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="relative">
              <BrandLogo className="h-8 w-8" />
              <span className="absolute -inset-1 rounded-full bg-primary/20 blur-md" />
            </div>
            <span className="font-mono text-lg font-semibold tracking-tight">
              SentryEye
            </span>
          </Link>
          <div className="flex items-center gap-3">
            {signedIn ? (
              <Button asChild size="sm">
                <Link to="/live">Open live detection</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/auth" search={{ mode: "signin" }}>
                    Sign in
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/live">Visitor mode</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/auth" search={{ mode: "signup" }}>
                    Get started
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="scanline pointer-events-none absolute inset-0 opacity-40" />
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 md:grid-cols-2 md:items-center">
          <div>
            <Badge variant="outline" className="mb-6 border-primary/40 text-primary">
              <span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Real-time · On-device inference
            </Badge>
            <h1 className="text-balance text-5xl font-bold leading-tight tracking-tight md:text-6xl">
              Catch drowsiness{" "}
              <span className="text-primary">before it catches the driver.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg text-muted-foreground">
              SentryEye runs a YOLO model directly in the browser or on your GPU
              server to detect closed eyes and yawning at 30+ FPS — no cloud
              round-trip, no lag.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="glow-primary">
                <Link to="/live">
                  <PlayCircle className="mr-2 h-5 w-5" />
                  Try as visitor — free, no signup
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/auth" search={{ mode: "signup" }}>
                  Create account
                </Link>
              </Button>
            </div>
          </div>

          <Card className="relative overflow-hidden border-primary/20 bg-card/70 p-6 backdrop-blur">
            <div className="scanline absolute inset-0 opacity-20" />
            <div className="relative space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  live · session_2f9a
                </span>
                <Badge className="bg-safe text-safe-foreground">SAFE</Badge>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "eyes", value: "OPEN", tone: "safe" },
                  { label: "yawn", value: "NONE", tone: "safe" },
                  { label: "PERCLOS", value: "0.08", tone: "safe" },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="rounded-md border border-border/50 bg-muted/30 p-3"
                  >
                    <div className="font-mono text-[10px] uppercase text-muted-foreground">
                      {m.label}
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold">
                      {m.value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="aspect-video rounded-md border border-border/50 bg-gradient-to-br from-muted/40 to-background/60" />
              <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
                <span>FPS 34</span>
                <span>GPU · WebGPU</span>
                <span>conf 0.87</span>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="border-t border-border/60 bg-card/30">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-3">
          {[
            {
              icon: Activity,
              title: "Real-time inference",
              body: "WebGPU-accelerated YOLO running in a dedicated worker, right in the browser.",
            },
            {
              icon: ShieldCheck,
              title: "Privacy-first",
              body: "Video never leaves the device. Only detection events and summaries are stored.",
            },
            {
              icon: LineChart,
              title: "Session analytics",
              body: "PERCLOS, yawn frequency, safety score, and fatigue trends for every session.",
            },
            {
              icon: Cpu,
              title: "Pluggable engines",
              body: "A model-agnostic detection-engine interface — swap models without code changes.",
            },
            {
              icon: Eye,
              title: "3 detection classes",
              body: "closed_eye · open_eye · yawning — mapped to semantic risk signals.",
            },
            {
              icon: PlayCircle,
              title: "Event timeline & PDF",
              body: "Chronological event timeline per session, exportable as a professional report.",
            },

          ].map((f) => (
            <Card key={f.title} className="border-border/50 bg-card/60 p-6">
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <footer className="border-t border-border/60 py-8 text-center font-mono text-xs text-muted-foreground">
        SentryEye · YOLO26n · 3 classes · on-device ·{" "}
        <Link to="/docs" className="underline underline-offset-4 hover:text-foreground">
          How it works
        </Link>
      </footer>
    </main>
  );
}

// Prevent silly redirect if server-side navigation ever hits it
void redirect;
