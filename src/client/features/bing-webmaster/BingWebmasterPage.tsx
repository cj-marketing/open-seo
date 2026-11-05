import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import { ExportMenu } from "@/client/components/ExportMenu";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { DataTableTabs } from "@/client/components/table/DataTableToolbar";
import { TabsTrigger } from "@/client/components/ui/tabs";
import {
  BingCrawlTab,
  BingUnavailable,
} from "@/client/features/bing-webmaster/BingWebmasterParts";
import {
  bingCrawlQueryOptions,
  bingTableQueryOptions,
} from "@/client/features/bing-webmaster/bingQueries";
import { DimensionSection } from "@/client/features/search-performance/SearchPerformanceDimensionSection";
import { SearchPerformanceLoadingState } from "@/client/features/search-performance/SearchPerformanceLoadingState";
import {
  exportDimensionRows,
  exportStriking,
  StrikingDistanceTable,
  type ExportTarget,
} from "@/client/features/search-performance/SearchPerformanceParts";
import { DateRangeSelect } from "@/client/features/search-performance/SearchPerformanceSelects";
import {
  SearchPerformanceTextFilters,
  type TextFilters,
} from "@/client/features/search-performance/SearchPerformanceTextFilters";
import { TotalsTable } from "@/client/features/search-performance/SearchPerformanceTotals";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  exportBingTable,
  getBingReport,
} from "@/serverFunctions/bingWebmaster";
import { BING_TABS, type BingSearch } from "@/types/schemas/bing-webmaster";
import { SEARCH_PERFORMANCE_DEFAULT_PAGE_SIZE } from "@/types/schemas/search-performance";

export function BingWebmasterPage({
  projectId,
  search,
  onSearchChange,
}: {
  projectId: string;
  search: BingSearch;
  onSearchChange: (update: Partial<BingSearch>) => void;
}) {
  const range = search.range ?? "last_28_days";
  const textFilters = useMemo<TextFilters>(
    () => ({
      pageFilter: search.pageText
        ? {
            operator: search.pageMatch ?? "contains",
            expression: search.pageText,
          }
        : undefined,
      queryFilter: search.queryText
        ? {
            operator: search.queryMatch ?? "contains",
            expression: search.queryText,
          }
        : undefined,
    }),
    [search.pageText, search.pageMatch, search.queryText, search.queryMatch],
  );
  const [showFilters, setShowFilters] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const activeFilterCount =
    Number(Boolean(textFilters.pageFilter)) +
    Number(Boolean(textFilters.queryFilter)) +
    Number(range !== "last_28_days");
  const tab = search.tab ?? "striking";
  const page = search.page ?? 1;
  const pageSize = search.size ?? SEARCH_PERFORMANCE_DEFAULT_PAGE_SIZE;

  const filterInput = { dateRange: range, ...textFilters };

  const reportQuery = useQuery({
    queryKey: ["bingReport", projectId, filterInput],
    queryFn: () => getBingReport({ data: { projectId, ...filterInput } }),
    placeholderData: keepPreviousData,
  });
  const report = reportQuery.data;
  const okReport = report?.status === "ok" ? report : null;

  const dimension = tab === "pages" ? "page" : "query";
  const tableQuery = useQuery({
    ...bingTableQueryOptions(projectId, dimension, page, pageSize, filterInput),
    enabled: okReport !== null && (tab === "queries" || tab === "pages"),
    // Hold the current rows while paging or filtering, but not across a tab
    // or project change: Query rows must not render under the Pages header.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === projectId &&
      previousQuery.queryKey[2] === dimension
        ? previous
        : undefined,
  });
  const crawlQuery = useQuery({
    ...bingCrawlQueryOptions(projectId),
    enabled: okReport !== null && tab === "crawl",
  });

  const handleExport = async (target: ExportTarget) => {
    if (!okReport || reportQuery.isPlaceholderData || isExporting) return;
    setIsExporting(true);
    try {
      if (tab === "striking") {
        await exportStriking(okReport, target, false);
        return;
      }
      if (tab === "crawl") return;
      const data = await exportBingTable({
        data: { projectId, dimension, ...filterInput },
      });
      await exportDimensionRows(
        dimension,
        data.rows,
        okReport.range,
        target,
        true,
      );
    } catch (error) {
      toast.error(getStandardErrorMessage(error, "Export failed"));
    } finally {
      setIsExporting(false);
    }
  };

  const resetFilters = () =>
    onSearchChange({
      page: undefined,
      pageText: undefined,
      pageMatch: undefined,
      queryText: undefined,
      queryMatch: undefined,
      range: undefined,
    });

  const reportError = (
    <QueryError
      error={
        reportQuery.error ??
        (report?.status === "error" ? new Error(report.code) : null)
      }
      fallback="Failed to load Bing data"
      onRetry={() => void reportQuery.refetch()}
      isRetrying={reportQuery.isFetching}
    />
  );

  const filtersPanel = (
    <SearchPerformanceTextFilters
      // Remount on URL changes (back/forward) so the draft matches.
      key={JSON.stringify(textFilters)}
      value={textFilters}
      showQuery
      activeFilterCount={activeFilterCount}
      onApply={(filters) => {
        onSearchChange({
          page: undefined,
          pageText: filters.pageFilter?.expression,
          pageMatch: filters.pageFilter?.operator,
          queryText: filters.queryFilter?.expression,
          queryMatch: filters.queryFilter?.operator,
        });
      }}
      onReset={resetFilters}
    />
  );

  const pagingProps = {
    page,
    pageSize,
    onPageChange: (nextPage: number) => onSearchChange({ page: nextPage }),
    onPageSizeChange: (size: number) =>
      onSearchChange({ page: undefined, size }),
    isFiltered: activeFilterCount > 0,
    onClearFilters: resetFilters,
  };

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Bing Performance</h1>
            <p className="text-sm text-muted-foreground">
              See your site&apos;s clicks, impressions, CTR, and position from
              Bing Webmaster Tools.
            </p>
          </div>
          {okReport ? (
            <span className="shrink-0 self-start text-sm text-muted-foreground sm:mt-1">
              {okReport.siteUrl}
            </span>
          ) : null}
        </div>

        {reportQuery.isPending ? (
          <SearchPerformanceLoadingState />
        ) : !report || report.status === "error" ? (
          <>
            {filtersPanel}
            {reportError}
          </>
        ) : report.status !== "ok" ? (
          <div className="max-w-2xl">
            <BingUnavailable
              projectId={projectId}
              status={report.status}
              sites={report.status === "site_not_found" ? report.sites : []}
            />
          </div>
        ) : (
          <>
            {reportQuery.isError ? reportError : null}
            {reportQuery.isPlaceholderData ? (
              <SearchPerformanceLoadingState />
            ) : (
              <TotalsTable report={report} showPosition />
            )}
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <DataTableTabs
                value={tab}
                onValueChange={(value) => {
                  const nextTab = BING_TABS.find((item) => item === value);
                  if (nextTab)
                    onSearchChange({ tab: nextTab, page: undefined });
                }}
                actions={
                  tab === "crawl" ? undefined : (
                    <ExportMenu
                      actions={["sheets", "csv"]}
                      onExport={(target) => void handleExport(target)}
                      busy={isExporting}
                      disabled={reportQuery.isPlaceholderData}
                    />
                  )
                }
              >
                <TabsTrigger value="striking">
                  {reportQuery.isPlaceholderData
                    ? "Striking distance"
                    : `Striking distance (${report.strikingDistance.length})`}
                </TabsTrigger>
                <TabsTrigger value="queries">Queries</TabsTrigger>
                <TabsTrigger value="pages">Pages</TabsTrigger>
                <TabsTrigger value="crawl">Crawl</TabsTrigger>
              </DataTableTabs>
              {tab === "crawl" ? null : (
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
                  <Button
                    type="button"
                    variant={showFilters ? "secondary" : "ghost"}
                    size="sm"
                    aria-expanded={showFilters}
                    aria-controls="search-performance-filters"
                    onClick={() => setShowFilters((current) => !current)}
                    title="Toggle table filters"
                  >
                    <SlidersHorizontal data-icon="inline-start" />
                    Filters
                    {activeFilterCount > 0 ? (
                      <Badge size="sm">{activeFilterCount}</Badge>
                    ) : null}
                  </Button>
                  {reportQuery.isFetching && !reportQuery.isPending ? (
                    <Spinner className="size-4 text-muted-foreground" />
                  ) : null}
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    <DateRangeSelect
                      value={range}
                      onChange={(value) =>
                        onSearchChange({ page: undefined, range: value })
                      }
                    />
                  </div>
                </div>
              )}

              {showFilters && tab !== "crawl" ? filtersPanel : null}
              {tab === "crawl" ? (
                <BingCrawlTab crawlQuery={crawlQuery} />
              ) : reportQuery.isPlaceholderData ? (
                <div className="p-8 text-sm" role="status">
                  Loading matching results…
                </div>
              ) : tab === "striking" ? (
                <StrikingDistanceTable
                  projectId={projectId}
                  rows={report.strikingDistance}
                  showPage={false}
                  {...pagingProps}
                />
              ) : (
                <DimensionSection
                  tableQuery={tableQuery}
                  unavailable={
                    <QueryError
                      error={new Error("Bing data is no longer available")}
                      fallback="Failed to load Bing data"
                      onRetry={() => void reportQuery.refetch()}
                      isRetrying={reportQuery.isFetching}
                    />
                  }
                  errorFallback="Failed to load Bing data"
                  emptyState={{
                    title: "No Bing data yet",
                    description:
                      "Bing can take a few weeks to report data for a new or low-traffic site.",
                  }}
                  keyLabel={tab === "queries" ? "Query" : "Page"}
                  showPosition
                  {...pagingProps}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
