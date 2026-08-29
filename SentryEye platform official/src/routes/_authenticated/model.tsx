import { createFileRoute } from "@tanstack/react-router";
import { Brain, Cpu, Tag, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useModelSelection } from "@/hooks/use-model-selection";
import {
  accuracyGrade,
  formatBytes,
  modelAccuracy,
  modelBestFor,
} from "@/features/drowsiness/labels";

export const Route = createFileRoute("/_authenticated/model")({
  head: () => ({
    meta: [
      { title: "AI model registry — SentryEye" },
      {
        name: "description",
        content:
          "Inspect the registered detection models: architecture, input size, class map, and evaluation metrics.",
      },
      { property: "og:title", content: "AI model registry — SentryEye" },
      {
        property: "og:description",
        content: "Architecture, class map, and evaluation metrics for every registered model.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ModelInfo,
});

function pct(v: number | null) {
  return v == null ? "—" : `${(v * 100).toFixed(2)}%`;
}

function ModelInfo() {
  const { models, selected, select, isLoading, error } = useModelSelection();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">AI model registry</h1>
        <p className="mt-1 text-muted-foreground">
          Every detection engine is registered as data. Selecting a model here changes what the
          inference provider loads — no code changes required.
        </p>
      </div>

      {isLoading ? (
        <Card className="border-border/60 bg-card/60 p-4 sm:p-6 text-sm text-muted-foreground">
          Loading model registry…
        </Card>
      ) : error ? (
        <Card className="border-destructive/40 bg-card/60 p-4 sm:p-6 text-sm text-destructive">
          {error.message}
        </Card>
      ) : !selected ? (
        <Card className="border-destructive/40 bg-card/60 p-4 sm:p-6 text-sm text-destructive">
          No active model in the registry.
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {models.map((m) => {
              const active = m.id === selected.id;
              return (
                <Card
                  key={m.id}
                  className={`p-4 transition-colors ${
                    active ? "border-primary/60 bg-primary/5" : "border-border/60 bg-card/60"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Brain className="mt-0.5 h-5 w-5 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{m.modelName}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        v{m.version} · {m.headFormat} · {m.imgsz}×{m.imgsz}
                      </p>
                    </div>
                    <div className="ml-auto shrink-0">
                      {active ? (
                        <Badge className="gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Selected
                        </Badge>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => select(m.id)}>
                          Use
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{modelBestFor(m)}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">Size</dt>
                      <dd className="font-mono">{formatBytes(m.fileSizeBytes)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Accuracy</dt>
                      <dd className="font-mono text-primary">{modelAccuracy(m).value}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Level</dt>
                      <dd className="font-mono">{accuracyGrade(m)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">mAP@50</dt>
                      <dd className="font-mono">{pct(m.map50)}</dd>
                    </div>
                  </dl>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-primary/20 bg-card/60 p-4 sm:p-6">
              <div className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Runtime configuration</h2>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Framework</dt>
                <dd className="font-mono">{selected.framework}</dd>
                <dt className="text-muted-foreground">Engine</dt>
                <dd className="font-mono">{selected.engineKind}</dd>
                <dt className="text-muted-foreground">Head format</dt>
                <dd className="font-mono">{selected.headFormat}</dd>
                <dt className="text-muted-foreground">Input size</dt>
                <dd className="font-mono">
                  {selected.imgsz}×{selected.imgsz}
                </dd>
                <dt className="text-muted-foreground">Resize</dt>
                <dd className="font-mono">{selected.postprocessConfig.resize}</dd>
                <dt className="text-muted-foreground">Normalize</dt>
                <dd className="font-mono">{selected.postprocessConfig.normalize}</dd>
                <dt className="text-muted-foreground">Class id offset</dt>
                <dd className="font-mono">{selected.postprocessConfig.classIdOffset}</dd>
                <dt className="text-muted-foreground">Trained</dt>
                <dd className="font-mono">
                  {selected.trainedAt ? new Date(selected.trainedAt).toLocaleDateString() : "—"}
                </dd>
              </dl>
            </Card>

            <Card className="border-border/60 bg-card/60 p-4 sm:p-6">
              <div className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Classes &amp; semantic map</h2>
              </div>
              <ul className="mt-4 space-y-2">
                {Object.entries(selected.labels).map(([id, label]) => (
                  <li key={id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-mono">{label}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {selected.semanticMap[label] ?? "unmapped"}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        id {id}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="border-border/60 bg-card/60 p-4 sm:p-6 md:col-span-2">
              <h2 className="font-semibold">Evaluation metrics</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                {[
                  ["Precision", pct(selected.precision)],
                  ["Recall", pct(selected.recall)],
                  ["mAP@0.5", pct(selected.map50)],
                  ["mAP@0.5 corrected", pct(selected.map50Corrected)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-border/60 bg-background/40 p-3">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="mt-1 font-mono text-xl">{v}</dd>
                  </div>
                ))}
              </dl>

              {selected.apPerClass ? (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold">Per-class accuracy</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Closed-eye is the microsleep signal — a miss here is an alarm that never
                    fires, so judge models on this row rather than the average.
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                          <th scope="col" className="py-2 pr-3 font-medium">
                            Class
                          </th>
                          <th scope="col" className="py-2 pr-3 font-medium">
                            AP@0.5
                          </th>
                          <th scope="col" className="py-2 pr-3 font-medium">
                            AP@0.5 corrected
                          </th>
                          <th scope="col" className="py-2 font-medium">
                            Recall
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(selected.apPerClass).map((cls) => (
                          <tr key={cls} className="border-b border-border/40 last:border-0">
                            <th scope="row" className="py-2 pr-3 text-left font-mono font-normal">
                              {cls}
                            </th>
                            <td className="py-2 pr-3 font-mono">
                              {pct(selected.apPerClass?.[cls] ?? null)}
                            </td>
                            <td className="py-2 pr-3 font-mono">
                              {pct(selected.apPerClassCorrected?.[cls] ?? null)}
                            </td>
                            <td className="py-2 font-mono">
                              {pct(selected.recallPerClass?.[cls] ?? null)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {selected.metricsNote ? (
                <p className="mt-4 text-xs text-muted-foreground">{selected.metricsNote}</p>
              ) : null}
              {selected.evaluatedOn ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Evaluated on {selected.evaluatedOn}.
                </p>
              ) : null}
              {selected.notes ? (
                <p className="mt-4 text-sm text-muted-foreground">{selected.notes}</p>
              ) : null}
            </Card>

          </div>
        </>
      )}
    </div>
  );
}
