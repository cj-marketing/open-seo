import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import {
  SkeletonCard,
  SkeletonTableRows,
} from "@/client/components/SkeletonPresets";
import { DataTableTabs } from "@/client/components/table/DataTableToolbar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { TabsTrigger } from "@/client/components/ui/tabs";
import {
  BingCrawlHealth,
  BingDimensionTable,
  BingTotals,
  BingTrafficChart,
  BingUnavailable,
} from "@/client/features/bing-webmaster/BingWebmasterParts";
import { getBingOverview, getBingTable } from "@/serverFunctions/bingWebmaster";
import {
  BING_DAYS,
  BING_DEFAULT_DAYS,
  type BingDays,
  type BingSearch,
} from "@/types/schemas/bing-webmaster";

const TABLE_ROW_LIMIT = 1000;

const DAYS_ITEMS = BING_DAYS.map((value) => ({
  value,
  label: `Last ${value} days`,
}));

function toBingDays(value: number): BingDays | undefined {
  return BING_DAYS.find((option) => option === value);
}

export function BingWebmasterPage({
  projectId,
  search,
  onSearchChange,
}: {
  projectId: string;
  search: BingSearch;
  onSearchChange: (update: Partial<BingSearch>) => void;
}) {
  const days =
    toBingDays(search.days ?? BING_DEFAULT_DAYS) ?? BING_DEFAULT_DAYS;
  const tab = search.tab ?? "queries";
  const dimension = tab === "pages" ? "page" : "query";

  const overviewQuery = useQuery({
    queryKey: ["bingOverview", projectId, days],
    queryFn: () => getBingOverview({ data: { projectId, days } }),
    placeholderData: keepPreviousData,
  });
  const overview = overviewQuery.data;

  const tableQuery = useQuery({
    queryKey: ["bingTable", projectId, dimension],
    queryFn: () =>
      getBingTable({
        data: { projectId, dimension, limit: TABLE_ROW_LIMIT },
      }),
    enabled: overview?.status === "ok",
    // Hold rows across a project change would show another site's data, and
    // across a tab change would show queries under the Pages header.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === projectId &&
      previousQuery.queryKey[2] === dimension
        ? previous
        : undefined,
  });

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Bing Insights</h1>
            <p className="text-sm text-muted-foreground">
              {overview?.status === "ok"
                ? `Clicks, impressions, and crawl health for ${overview.trend.siteUrl} from Bing Webmaster Tools.`
                : "Clicks, impressions, and crawl health from Bing Webmaster Tools."}
            </p>
          </div>
          <Select
            items={DAYS_ITEMS}
            value={days}
            onValueChange={(value) => {
              if (value == null) return;
              onSearchChange({ days: toBingDays(value) });
            }}
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_ITEMS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {overviewQuery.isPending ? (
          <SkeletonCard />
        ) : !overview ? (
          <QueryError
            error={overviewQuery.error}
            fallback="Failed to load Bing data"
            onRetry={() => void overviewQuery.refetch()}
            isRetrying={overviewQuery.isFetching}
          />
        ) : overview.status === "error" ? (
          <QueryError
            error={new Error(overview.code)}
            fallback="Failed to load Bing data"
            onRetry={() => void overviewQuery.refetch()}
            isRetrying={overviewQuery.isFetching}
          />
        ) : overview.status !== "ok" ? (
          <BingUnavailable
            projectId={projectId}
            status={overview.status}
            sites={overview.status === "site_not_found" ? overview.sites : []}
          />
        ) : (
          <>
            <BingTotals totals={overview.trend.totals} />
            <BingTrafficChart rows={overview.trend.rows} />
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <DataTableTabs
                value={tab}
                onValueChange={(value) => {
                  if (value === "queries" || value === "pages")
                    onSearchChange({ tab: value });
                }}
              >
                <TabsTrigger value="queries">Queries</TabsTrigger>
                <TabsTrigger value="pages">Pages</TabsTrigger>
              </DataTableTabs>
              <BingTableBody
                tableQuery={tableQuery}
                keyLabel={tab === "pages" ? "Page" : "Query"}
              />
            </div>
            <BingCrawlHealth crawl={overview.crawl} />
          </>
        )}
      </div>
    </div>
  );
}

/** Queries/Pages tab body: loading, error, or the sortable table with its window note. */
function BingTableBody({
  tableQuery,
  keyLabel,
}: {
  tableQuery: ReturnType<
    typeof useQuery<Awaited<ReturnType<typeof getBingTable>>>
  >;
  keyLabel: string;
}) {
  const result = tableQuery.data;
  if (!result) {
    return tableQuery.isError ? (
      <div className="p-4">
        <QueryError
          error={tableQuery.error}
          fallback="Failed to load Bing data"
          onRetry={() => void tableQuery.refetch()}
          isRetrying={tableQuery.isFetching}
        />
      </div>
    ) : (
      <SkeletonTableRows className="p-4" />
    );
  }
  if (result.status === "error") {
    return (
      <div className="p-4">
        <QueryError
          error={new Error(result.code)}
          fallback="Failed to load Bing data"
          onRetry={() => void tableQuery.refetch()}
          isRetrying={tableQuery.isFetching}
        />
      </div>
    );
  }
  // The overview already handled the other statuses for this project.
  if (result.status !== "ok") return null;
  return (
    <>
      <div className="p-4">
        <BingDimensionTable keyLabel={keyLabel} rows={result.rows} />
      </div>
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        Bing reports queries and pages weekly. Values are summed over the
        available window
        {result.startDate && result.endDate
          ? ` (${result.startDate} to ${result.endDate})`
          : ""}
        , not the date range above.
      </p>
    </>
  );
}
