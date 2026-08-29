import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  ENGINE_LADDER,
  MICRO_EVENTS,
  PERSISTED_EVENT_TYPES,
  ROLE_MATRIX,
  SCORING_DOC,
  SECTIONS,
  SYNC_STATES,
} from "@/features/docs/system-report";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "How SentryEye works — system & feature report" },
      {
        name: "description",
        content:
          "Full technical report of SentryEye: on-device YOLO inference, the micro-event catalogue, safety scoring, offline sync states and the driver/manager role matrix.",
      },
      { property: "og:title", content: "How SentryEye works — system & feature report" },
      {
        property: "og:description",
        content:
          "On-device inference, micro-events, safety scoring, offline-first shift sync and role boundaries — documented from the shipped constants.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DocsPage,
});

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-lg font-semibold tracking-tight text-foreground">
      {children}
    </h2>
  );
}

function DocsPage() {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Link>

        <header className="mt-6">
          <Badge variant="secondary" className="font-mono text-xs">
            System report
          </Badge>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
            How SentryEye works
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Every number on this page is read from the same constants the runtime uses — the
            thresholds, weights and sync states below are the ones actually shipped, not a
            description of them.
          </p>
        </header>

        <div className="mt-10 space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.id} className="space-y-3">
              <SectionHeading id={section.id}>{section.title}</SectionHeading>
              <p className="text-sm text-muted-foreground">{section.summary}</p>
              <ul className="space-y-2">
                {section.bullets.map((b) => (
                  <li key={b} className="flex gap-3 text-sm leading-relaxed text-foreground">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="space-y-3">
            <SectionHeading id="engine">Engine selection ladder</SectionHeading>
            <ol className="space-y-2">
              {ENGINE_LADDER.map((step, i) => (
                <li key={step} className="flex gap-3 text-sm leading-relaxed text-foreground">
                  <span className="font-mono text-xs text-primary">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="space-y-3">
            <SectionHeading id="micro-events">Micro-event catalogue</SectionHeading>
            <p className="text-sm text-muted-foreground">
              Per-frame detections never leave the device. The aggregator turns them into debounced
              spells; only the transitions below are stored.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Event</th>
                    <th scope="col" className="px-3 py-2 font-medium">Stored as</th>
                    <th scope="col" className="px-3 py-2 font-medium">Severity</th>
                    <th scope="col" className="px-3 py-2 font-medium">Trigger</th>
                  </tr>
                </thead>
                <tbody>
                  {MICRO_EVENTS.map((e) => (
                    <tr key={e.kind} className="border-t border-border align-top">
                      <td className="px-3 py-2 font-mono text-xs text-foreground">{e.kind}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {e.persistedAs ?? <span className="italic">not stored</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{e.severity}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.trigger}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {PERSISTED_EVENT_TYPES.map((t) => (
                <Badge key={t.type} variant="outline" className="font-mono text-xs">
                  {t.label}
                </Badge>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading id="scoring">Safety scoring</SectionHeading>
            <p className="text-sm leading-relaxed text-muted-foreground">{SCORING_DOC.formula}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Weights</p>
                <ul className="mt-2 space-y-1 font-mono text-xs text-foreground">
                  {Object.entries(SCORING_DOC.weights).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{k}</span>
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Caps</p>
                <ul className="mt-2 space-y-1 font-mono text-xs text-foreground">
                  {Object.entries(SCORING_DOC.caps).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{k}</span>
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Risk bands</p>
                <ul className="mt-2 space-y-1 font-mono text-xs text-foreground">
                  {Object.entries(SCORING_DOC.thresholds).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">≥ {k}</span>
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <p className="text-xs text-muted-foreground">
              Organizations can override every value above; the defaults shown are the fallback used
              when no custom scoring config is set.
            </p>
          </section>

          <section className="space-y-3">
            <SectionHeading id="sync">Offline sync state machine</SectionHeading>
            <ul className="space-y-2">
              {SYNC_STATES.map((s) => (
                <li key={s.state} className="text-sm leading-relaxed">
                  <span className="font-mono text-xs text-primary">{s.state}</span>
                  <span className="text-muted-foreground"> — {s.meaning}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <SectionHeading id="roles">Role matrix</SectionHeading>
            <div className="grid gap-3 sm:grid-cols-3">
              {ROLE_MATRIX.map((r) => (
                <Card key={r.role} className="p-4">
                  <p className="text-sm font-semibold text-foreground">{r.role}</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{r.can}</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    <span className="text-destructive">Cannot:</span> {r.cannot}
                  </p>
                </Card>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Route gating is a UX convenience only — row-level security in the database is the real
              boundary.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
