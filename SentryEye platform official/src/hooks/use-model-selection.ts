import { useModelContext } from "@/features/inference/model-context";

/**
 * Thin compatibility wrapper over the app-level model context. Kept so pages
 * written against the old hook keep working while the model itself is owned
 * by <ModelProvider> for the whole app lifetime.
 */
export function useModelSelection() {
  const { models, selected, selectedId, select, isLoading, error, warmup, warm } =
    useModelContext();
  return { models, selected, selectedId, select, isLoading, error, warmup, warm };
}
