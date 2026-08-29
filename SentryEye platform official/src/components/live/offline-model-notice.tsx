import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CloudOff, HardDrive } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useModelContext } from "@/features/inference/model-context";
import { runtimeModelAsset } from "@/features/inference/engine-preference";
import { hasCachedModel } from "@/features/inference/model-store";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Shown only when the device is offline AND the selected model is not stored
 * on it — the one case where detection genuinely cannot start. Everything else
 * keeps working offline, so we stay silent.
 */
export function OfflineModelNotice() {
  const { selected: model } = useModelContext();
  const online = useOnlineStatus();
  const [stored, setStored] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    if (!model) {
      setStored(null);
      return;
    }
    const asset = runtimeModelAsset(model);
    void hasCachedModel(asset.id, asset.url).then((ok) => {
      if (alive) setStored(ok);
    });
    return () => {
      alive = false;
    };
  }, [model, online]);

  if (online || stored !== false) return null;

  return (
    <Card className="flex flex-wrap items-center gap-3 border-amber-500/40 bg-amber-500/5 p-4">
      <CloudOff className="h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">This model isn't saved on your device yet</div>
        <p className="text-xs text-muted-foreground">
          You're offline, so it can't be downloaded right now. Reconnect once and save a model —
          after that, detection runs with no connection at all.
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to="/models">
          <HardDrive className="mr-2 h-4 w-4" aria-hidden="true" /> Offline models
        </Link>
      </Button>
    </Card>
  );
}
