import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { Button } from "@/client/components/ui/button";
import { TabsTrigger } from "@/client/components/ui/tabs";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import type { FilterInput } from "@/client/features/search-performance/searchPerformanceQueries";
import {
  buildCannibalizationColumns,
  buildDecayColumns,
} from "@/client/features/search-performance/SearchInsightsColumns";
import {
  getSearchCannibalization,
  getSearchDecay,
} from "@/serverFunctions/searchInsights";

type Dimension = "page" | "query";

/** The two insight tabs, for the tab bar of a web search report. */
export function InsightTabTriggers() {
  return (
    <>
      <TabsTrigger value="decay">Decay</TabsTrigger>
      <TabsTrigger value="cannibalization">Cannibalization</TabsTrigger>
    </>
  );
}

function Notice({ children }: { children: string }) {
  return <p className="mb-3 text-sm text-muted-foreground">{children}</p>;
}

function InsightsLoading() {
  return <SkeletonTableRows className="p-4" />;
}

const GSC_UNAVAILABLE = (projectId: string) => (
  <div className="max-w-2xl p-4">
    <GoogleConnectionCard provider="gsc" projectId={projectId} />
  </div>
);

type TabProps = {
  projectId: string;
  filterInput: FilterInput;
  isFiltered: boolean;
  onClearFilters: () => void;
};

export function InsightTabBody({
  tab,
  ...props
}: TabProps & { tab: "decay" | "cannibalization" }) {
  return tab === "decay" ? (
    <DecayTab {...props} />
  ) : (
    <CannibalizationTab {...props} />
  );
}

/** Pages or queries that lost clicks or impressions against the period before
 *  the selected range. Fetched only while this tab is open. */
function DecayTab({
  projectId,
  filterInput,
  isFiltered,
  onClearFilters,
}: TabProps) {
  const [dimension, setDimension] = useState<Dimension>("page");
  const query = useQuery({
    queryKey: ["searchDecay", projectId, dimension, filterInput],
    queryFn: () =>
      getSearchDecay({ data: { projectId, dimension, ...filterInput } }),
  });
  const data = query.data;
  const keyLabel = dimension === "page" ? "Page" : "Query";
  const columns = useMemo(() => buildDecayColumns(keyLabel), [keyLabel]);
  const table = useDataTable({
    data: data?.connected ? data.rows : [],
    columns,
    withSorting: true,
  });

  if (query.isPending) return <InsightsLoading />;
  if (query.isError || !data) {
    return (
      <div className="p-4">
        <QueryError
          error={query.error}
          fallback="Failed to load Search Console data"
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      </div>
    );
  }
  if (!data.connected) return GSC_UNAVAILABLE(projectId);

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={dimension === "page" ? "secondary" : "ghost"}
          aria-pressed={dimension === "page"}
          onClick={() => setDimension("page")}
        >
          Pages
        </Button>
        <Button
          type="button"
          size="sm"
          variant={dimension === "query" ? "secondary" : "ghost"}
          aria-pressed={dimension === "query"}
          onClick={() => setDimension("query")}
        >
          Queries
        </Button>
      </div>
      <Notice>
        {`Compared with ${data.previous.startDate} to ${data.previous.endDate}. Only ${dimension === "page" ? "pages" : "queries"} with at least 50 impressions in that earlier period are listed, biggest loss in clicks first, then in impressions.`}
      </Notice>
      {data.mayBeIncomplete ? (
        <Notice>
          Google returned its maximum of 25,000 rows, so the quietest entries
          may be missing.
        </Notice>
      ) : null}
      <DataTable
        table={table}
        isFiltered={isFiltered}
        onClearFilters={onClearFilters}
        isRefreshing={query.isFetching}
        empty={{
          title: "Nothing is declining",
          description: `No ${dimension === "page" ? "page" : "query"} with at least 50 earlier impressions lost clicks or impressions.`,
        }}
      />
    </div>
  );
}

/** Queries where two or more of the site's pages each get a real share of the
 *  impressions. Fetched only while this tab is open. */
function CannibalizationTab({
  projectId,
  filterInput,
  isFiltered,
  onClearFilters,
}: TabProps) {
  const query = useQuery({
    queryKey: ["searchCannibalization", projectId, filterInput],
    queryFn: () =>
      getSearchCannibalization({ data: { projectId, ...filterInput } }),
  });
  const data = query.data;
  const columns = useMemo(() => buildCannibalizationColumns(), []);
  const table = useDataTable({
    data: data?.connected ? data.rows : [],
    columns,
    withSorting: true,
  });

  if (query.isPending) return <InsightsLoading />;
  if (query.isError || !data) {
    return (
      <div className="p-4">
        <QueryError
          error={query.error}
          fallback="Failed to load Search Console data"
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      </div>
    );
  }
  if (!data.connected) return GSC_UNAVAILABLE(projectId);

  return (
    <div className="p-4">
      <Notice>
        Queries where two or more of your pages each get at least 10% of the
        impressions and at least 10 impressions, biggest first. Links that
        differ only by a #fragment count as one page.
      </Notice>
      {data.mayBeIncomplete ? (
        <Notice>
          Google returned its maximum of 25,000 rows, so some queries may be
          missing.
        </Notice>
      ) : null}
      <DataTable
        table={table}
        isFiltered={isFiltered}
        onClearFilters={onClearFilters}
        isRefreshing={query.isFetching}
        empty={{
          title: "No competing pages found",
          description:
            "No query has two or more of your pages with a real share of its impressions.",
        }}
      />
    </div>
  );
}
