import { Button } from "@/components/ui/button";
import { PERIODS, type PeriodKey } from "@/features/fleet/types";

export function PeriodTabs({
  value,
  onChange,
}: {
  value: PeriodKey;
  onChange: (key: PeriodKey) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Reporting period">
      {PERIODS.map((p) => (
        <Button
          key={p.key}
          size="sm"
          variant={p.key === value ? "default" : "outline"}
          onClick={() => onChange(p.key)}
          aria-pressed={p.key === value}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}
