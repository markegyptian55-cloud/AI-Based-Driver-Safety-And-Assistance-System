import { useState } from "react";
import { IdCard, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDrivers } from "@/hooks/use-drivers";
import { driverDisplayLabel } from "@/features/drivers/drivers-data";
import { formatError } from "@/lib/format-error";

const NONE = "__none__";

/**
 * Picks who is behind the wheel for the current analysis. The selection is
 * stored on the session, so every report, history row and PDF carries the
 * driver ID.
 */
export function DriverPicker({ disabled }: { disabled?: boolean }) {
  const { drivers, active, activeId, selectDriver, add, remove, signedIn, driverLabel } =
    useDrivers();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [driverCode, setDriverCode] = useState("");

  async function handleAdd() {
    if (!fullName.trim() || !driverCode.trim()) {
      toast.error("Driver name and driver ID are both required");
      return;
    }
    try {
      await add.mutateAsync({ fullName: fullName.trim(), driverCode: driverCode.trim() });
      toast.success("Driver added");
      setFullName("");
      setDriverCode("");
      setOpen(false);
    } catch (err) {
      toast.error(formatError(err).message);
    }
  }

  return (
    <Card className="border-border/60 bg-card/60 p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <IdCard className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Driver identity
            </div>
            <div className="truncate text-sm">Analysing: {driverLabel}</div>
          </div>
        </div>

        {signedIn ? (
          <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-auto">
            <Select
              value={activeId ?? NONE}
              onValueChange={(v) => selectDriver(v === NONE ? null : v)}
              disabled={disabled}
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Select a driver" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>My own account</SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {driverDisplayLabel(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={disabled}>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Add driver
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add a driver</DialogTitle>
                  <DialogDescription>
                    Drivers are private to your account and are attached to every session you
                    record for them.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="driver-name">Full name</Label>
                    <Input
                      id="driver-name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ahmed Hassan"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="driver-code">Driver ID</Label>
                    <Input
                      id="driver-code"
                      value={driverCode}
                      onChange={(e) => setDriverCode(e.target.value)}
                      placeholder="D-014"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => void handleAdd()} disabled={add.isPending}>
                    {add.isPending ? "Saving…" : "Save driver"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {active ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || remove.isPending}
                onClick={() => void remove.mutateAsync(active.id).catch(() => undefined)}
                aria-label={`Remove ${active.fullName}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="col-span-2 text-xs text-muted-foreground sm:col-auto">
            Sign in to keep a driver roster and attach a driver ID to each session.
          </div>
        )}
      </div>
    </Card>
  );
}
