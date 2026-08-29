// Reliable error serialization for UI display, logging, and toasts.
// Avoids "[object Object]" for non-Error throwables (worker messages,
// rejected fetch bodies, plain objects, etc).

export interface FormattedError {
  message: string;
  stack?: string;
  name?: string;
}

export function formatError(err: unknown): FormattedError {
  if (err instanceof Error) {
    return { message: err.message || err.name || "Error", stack: err.stack, name: err.name };
  }
  if (typeof err === "string") return { message: err };
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    const msg =
      (typeof anyErr.message === "string" && anyErr.message) ||
      (typeof anyErr.error === "string" && anyErr.error) ||
      safeJson(err);
    return { message: msg, stack: typeof anyErr.stack === "string" ? anyErr.stack : undefined };
  }
  return { message: String(err) };
}

export function errorMessage(err: unknown): string {
  return formatError(err).message;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const IS_DEV = import.meta.env.DEV;
