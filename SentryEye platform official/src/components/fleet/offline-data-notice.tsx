import { CloudOff } from "lucide-react";

import { Card } from "@/components/ui/card";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Fleet data lives in the cloud, so manager screens need a connection. When
 * offline we say so plainly instead of letting queries fail with an error.
 */
export function OfflineDataNotice() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <Card className="flex items-center gap-3 border-amber-500/40 bg-amber-500/5 p-4">
      <CloudOff className="h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-sm font-medium">You're offline</div>
        <p className="text-xs text-muted-foreground">
          Fleet data loads from the cloud. Reconnect to see the latest driver reports — anything
          already on screen may be out of date.
        </p>
      </div>
    </Card>
  );
}
