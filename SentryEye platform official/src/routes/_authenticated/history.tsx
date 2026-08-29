import { createFileRoute } from "@tanstack/react-router";
import { LastSessionExport } from "@/components/report/last-session-export";
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryFilterBar } from "@/components/history/history-filters";
import { HistoryTable } from "@/components/history/history-table";
import { HistoryPagination } from "@/components/history/history-pagination";
import { HistoryEmptyState } from "@/components/history/history-empty";
import {
  DEFAULT_HISTORY_QUERY,
  deleteSession,
  fetchHistoryFilterOptions,
  fetchHistoryPage,
  type HistoryQuery,
  type HistorySortKey,
} from "@/features/history/history-data";
import { errorMessage } from "@/lib/format-error";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "Session history — SentryEye" },
      {
        name: "description",
        content:
          "Searchable, filterable history of completed driver monitoring sessions with safety score, fatigue level, alerts and quick actions.",
      },
      { property: "og:title", content: "Session history — SentryEye" },
      {
        property: "og:description",
        content: "Browse, filter and manage every completed driver monitoring session.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HistoryPage,
});

function isFiltered(q: HistoryQuery) {
  return (
    q.search.trim() !== "" ||
    q.driver !== "all" ||
    q.model !== "all" ||
    q.analysisType !== "all" ||
    q.fatigue !== "all" ||
    !!q.from ||
    !!q.to
  );
}

function HistoryPage() {
  const [query, setQuery] = useState<HistoryQuery>(DEFAULT_HISTORY_QUERY);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const options = useQuery({
    queryKey: ["history", "filter-options"],
    queryFn: fetchHistoryFilterOptions,
    staleTime: 60_000,
  });

  const page = useQuery({
    queryKey: ["history", "page", query],
    queryFn: () => fetchHistoryPage(query),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteSession(id),
    onMutate: (id) => setDeletingId(id),
    onSuccess: () => {
      toast.success("Session deleted");
      queryClient.invalidateQueries({ queryKey: ["history"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => setDeletingId(null),
  });

  const patch = (p: Partial<HistoryQuery>) => setQuery((prev) => ({ ...prev, ...p }));

  const onSort = (key: HistorySortKey) =>
    patch(
      query.sortKey === key
        ? { sortDir: query.sortDir === "asc" ? "desc" : "asc" }
        : { sortKey: key, sortDir: "desc" },
    );

  const rows = page.data?.rows ?? [];
  const total = page.data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Session history</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every completed driver session, paged straight from the database.
        </p>
      </div>

      <LastSessionExport />

      {options.data && (options.data.drivers.length > 0 || isFiltered(query)) ? (
        <HistoryFilterBar options={options.data} query={query} onChange={patch} />
      ) : null}

      {page.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : page.error ? (
        <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-foreground">
          {errorMessage(page.error)}
        </Card>
      ) : rows.length === 0 ? (
        <HistoryEmptyState filtered={isFiltered(query)} />
      ) : (
        <>
          <HistoryTable
            rows={rows}
            sortKey={query.sortKey}
            sortDir={query.sortDir}
            onSort={onSort}
            onDelete={(s) => remove.mutate(s.id)}
            deletingId={deletingId}
          />
          <HistoryPagination
            page={query.page}
            pageSize={query.pageSize}
            total={total}
            onPageChange={(p) => patch({ page: p })}
          />
        </>
      )}
    </div>
  );
}
