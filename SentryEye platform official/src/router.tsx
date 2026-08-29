import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { routeTree } from "./routeTree.gen";
import { errorMessage } from "./lib/format-error";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Network hiccups are retried once; auth/permission errors are not
        // worth retrying and surface immediately in the UI.
        retry: (failureCount, error) => {
          const msg = errorMessage(error).toLowerCase();
          if (msg.includes("jwt") || msg.includes("permission") || msg.includes("row-level")) {
            return false;
          }
          return failureCount < 1;
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        // Panels render their own inline error state; log for diagnostics only.
        console.error("[query]", errorMessage(error));
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        // Mutations without a local handler still tell the user what failed.
        if (!mutation.options.onError) toast.error(errorMessage(error));
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
