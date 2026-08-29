import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { errorMessage } from "@/lib/format-error";
import { reportLovableError } from "@/lib/lovable-error-reporting";

interface Props {
  children: ReactNode;
  /** Shown above the message so the user knows which area failed. */
  title?: string;
  /** Rendered instead of the default card when provided. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Generic render-time error boundary. Keeps a failing panel contained so the
 * rest of the application (navigation, other panels) stays usable.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[error-boundary]", error, info.componentStack);
    reportLovableError(error, { boundary: "react_error_boundary" });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <Card className="border-destructive/40 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 space-y-2">
            <h2 className="text-sm font-semibold text-foreground">
              {this.props.title ?? "Something went wrong"}
            </h2>
            <p className="break-words text-sm text-muted-foreground">{errorMessage(error)}</p>
            <Button size="sm" variant="outline" onClick={this.reset}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        </div>
      </Card>
    );
  }
}

/** Inline, non-crashing failure state for async data panels. */
export function ErrorState({
  title = "Couldn't load this data",
  error,
  onRetry,
  retrying,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <Card className="border-destructive/40 bg-destructive/5 p-6" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 space-y-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="break-words text-sm text-muted-foreground">{errorMessage(error)}</p>
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
              <RefreshCw
                className={`mr-2 h-4 w-4 ${retrying ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
