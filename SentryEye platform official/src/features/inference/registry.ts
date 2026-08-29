// Provider factory. Callers pick a provider by id; the router is just another
// provider from the caller's point of view.

import type { InferenceProvider } from "./types";
import { BrowserOnnxProvider } from "./browser-onnx-provider";
import { RemoteFastApiProvider } from "./remote-fastapi-provider";
import { HybridAutoProvider } from "./hybrid-router";

export type ProviderId = "browser-onnx" | "remote-fastapi" | "hybrid-auto";

const KNOWN: ProviderId[] = ["browser-onnx", "remote-fastapi", "hybrid-auto"];

export function normalizeProviderId(id: string | null | undefined): ProviderId {
  if (!id) return "browser-onnx";
  if ((KNOWN as string[]).includes(id)) return id as ProviderId;
  // Legacy / stale values from earlier schema versions.
  if (id === "browser") return "browser-onnx";
  if (id === "remote") return "remote-fastapi";
  if (id === "hybrid" || id === "auto") return "hybrid-auto";
  console.warn(`[inference] unknown provider id "${id}", falling back to browser-onnx`);
  return "browser-onnx";
}

export function createProvider(id: string): InferenceProvider {
  const normalized = normalizeProviderId(id);
  if (normalized === "remote-fastapi") return new RemoteFastApiProvider();
  if (normalized === "hybrid-auto") return new HybridAutoProvider();
  return new BrowserOnnxProvider();
}
