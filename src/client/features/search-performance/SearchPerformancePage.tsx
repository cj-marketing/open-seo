import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import { ExportMenu } from "@/client/components/ExportMenu";
import { DataTableTabs } from "@/client/components/table/DataTableToolbar";
import { TabsTrigger } from "@/client/components/ui/tabs";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import { DimensionSection } from "@/client/features/search-performance/SearchPerformanceDimensionSection";
import { SearchPerformanceToolbar } from "@/client/features/search-performance/SearchPerformanceToolbar";
import { SearchPerformanceLoadingState } from "@/client/features/search-performance/SearchPerformanceLoadingState";
import {
  buildFilterInput,
  tableQueryOptions,
  tabDimension,
} from "@/client/features/search-performance/searchPerformanceQueries";
import {
  InsightTabBody,
  InsightTabTriggers,
} from "@/client/features/search-performance/SearchPerformanceInsights";
import { SearchPerformanceChartCard } from "@/client/features/search-performance/SearchPerformanceChartCard";
import {
  SearchPerformanceTextFilters,
  type TextFilters,
} from "@/client/features/search-performance/SearchPerformanceTextFilters";
import {
  exportDimensionRows,
  exportStriking,
  StrikingDistanceTable,
  type ExportTarget,
} from "@/client/features/search-performance/SearchPerformanceParts";
import { TotalsTable } from "@/client/features/search-performance/SearchPerformanceTotals";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  exportSearchPerformanceTable,
  getSearchPerformanceReport,
} from "@/serverFunctions/searchPerformance";
import {
  SEARCH_PERFORMANCE_DEFAULT_PAGE_SIZE,
  SEARCH_PERFORMANCE_TABS,
  type SearchPerformanceSearch,
} from "@/types/schemas/search-performance";

export function SearchPerformancePage({
  projectId,
  search,
  onSearchChange,
}: {
  projectId: string;
  search: SearchPerformanceSearch;
  onSearchChange: (update: Partial<SearchPerformanceSearch>) => void;
}) {
  const queryClient = useQueryClient();
  const { type, range, device, country } = search;
  // Discover and Google News report pages only, with no queries or position.
  const isWeb = (type ?? "web") === "web";
  const textFilters = useMemo<TextFilters>(
    () => ({
      pageFilter: search.pageText
        ? {
            operator: search.pageMatch ?? "contains",
            expression: search.pageText,
          }
        : undefined,
      queryFilter:
        search.queryText && isWeb
          ? {
              operator: search.queryMatch ?? "contains",
              expression: search.queryText,
            }
          : undefined,
    }),
    [
      search.pageText,
      search.pageMatch,
      search.queryText,
      search.queryMatch,
      isWeb,
    ],
  );
  const [showFilters, setShowFilters] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const activeFilterCount =
    Number(Boolean(textFilters.pageFilter)) +
    Number(Boolean(textFilters.queryFilter)) +
    Number(Boolean(country)) +
    Number(Boolean(device)) +
    Number(range !== undefined && range !== "last_28_days");
  const tab = isWeb ? (search.tab ?? "striking") : "pages";
  const page = search.page ?? 1;
  const pageSize = search.size ?? SEARCH_PERFORMANCE_DEFAULT_PAGE_SIZE;

  const filterInput = {
    ...buildFilterInput({ type, range, device, country }),
    ...textFilters,
  };

  const reportQuery = useQuery({
    queryKey: ["searchPerformance", projectId, filterInput],
    queryFn: () =>
      getSearchPerformanceReport({ data: { projectId, ...filterInput } }),
    placeholderData: keepPreviousData,
  });
  const report = reportQuery.data;

  const isTableTab = tab === "queries" || tab === "pages";
  const isInsightTab = tab === "decay" || tab === "cannibalization";
  const dimension = tabDimension(tab);
  const tableQuery = useQuery({
    ...tableQueryOptions(projectId, dimension, page, pageSize, filterInput),
    enabled: report?.connected === true && isTableTab,
    // Hold the current rows while paging or filtering, but not across a tab
    // or project change: Query rows must not render under the Pages header.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === projectId &&
      previousQuery.queryKey[2] === dimension
        ? previous
        : undefined,
  });

  // Warm the Queries tab (first page) as soon as the report connects so the tab
  // opens instantly instead of showing a spinner. Free first-party GSC data.
  useEffect(() => {
    if (report?.connected !== true || !isWeb) return;
    void queryClient.prefetchQuery(
      tableQueryOptions(
        projectId,
        "query",
        1,
        SEARCH_PERFORMANCE_DEFAULT_PAGE_SIZE,
        {
          ...buildFilterInput({ type, range, device, country }),
          ...textFilters,
        },
      ),
    );
  }, [
    report?.connected,
    isWeb,
    projectId,
    type,
    range,
    device,
    country,
    textFilters,
    queryClient,
  ]);

  const handleExport = async (target: ExportTarget) => {
    if (
      !report?.connected ||
      reportQuery.isPlaceholderData ||
      isExporting ||
      isInsightTab
    )
      return;
    setIsExporting(true);
    try {
      if (tab === "striking") {
        await exportStriking(report, target, true);
        return;
      }
      const data = await exportSearchPerformanceTable({
        data: { projectId, dimension, ...filterInput },
      });
      await exportDimensionRows(
        dimension,
        data.rows,
        report.range,
        target,
        isWeb,
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
      country: undefined,
      device: undefined,
      range: undefined,
    });

  const reportError = (
    <QueryError
      error={reportQuery.error}
      fallback="Failed to load Search Console data"
      onRetry={() => void reportQuery.refetch()}
      isRetrying={reportQuery.isFetching}
    />
  );

  const filtersPanel = (
    <SearchPerformanceTextFilters
      // Remount on URL changes (back/forward) so the draft matches.
      key={JSON.stringify(textFilters)}
      value={textFilters}
      showQuery={isWeb}
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

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Search Performance</h1>
            <p className="text-sm text-muted-foreground">
              See your site&apos;s clicks, impressions, CTR, and position from
              Google Search Console.
            </p>
          </div>
          {report?.connected ? (
            <Link
              to="/p/$projectId/settings/integrations"
              params={{ projectId }}
              className="shrink-0 self-start text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:mt-1"
            >
              Change property
            </Link>
          ) : null}
        </div>

        {reportQuery.isPending ? (
          <SearchPerformanceLoadingState />
        ) : !report ? (
          <>
            {filtersPanel}
            {reportError}
          </>
        ) : !report.connected ? (
          <div className="max-w-2xl">
            <GoogleConnectionCard provider="gsc" projectId={projectId} />
          </div>
        ) : (
          <>
            {reportQuery.isError ? reportError : null}
            {reportQuery.isPlaceholderData ? (
              <SearchPerformanceLoadingState />
            ) : (
              <>
                <TotalsTable report={report} showPosition={isWeb} />
                <SearchPerformanceChartCard
                  projectId={projectId}
                  report={report}
                />
              </>
            )}
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <DataTableTabs
                value={tab}
                onValueChange={(value) => {
                  const nextTab = SEARCH_PERFORMANCE_TABS.find(
                    (item) => item === value,
                  );
                  if (nextTab)
                    onSearchChange({ tab: nextTab, page: undefined });
                }}
                actions={
                  <ExportMenu
                    actions={["sheets", "csv"]}
                    onExport={(target) => void handleExport(target)}
                    busy={isExporting}
                    disabled={reportQuery.isPlaceholderData || isInsightTab}
                  />
                }
              >
                {isWeb ? (
                  <>
                    <TabsTrigger value="striking">
                      {reportQuery.isPlaceholderData
                        ? "Striking distance"
                        : `Striking distance (${report.strikingDistance.length})`}
                    </TabsTrigger>
                    <TabsTrigger value="queries">Queries</TabsTrigger>
                  </>
                ) : null}
                <TabsTrigger value="pages">Pages</TabsTrigger>
                {isWeb ? <InsightTabTriggers /> : null}
              </DataTableTabs>
              <SearchPerformanceToolbar
                showFilters={showFilters}
                onToggleFilters={() => setShowFilters((current) => !current)}
                activeFilterCount={activeFilterCount}
                isFetching={reportQuery.isFetching && !reportQuery.isPending}
                search={search}
                countries={report.countries}
                onSearchChange={onSearchChange}
              />

              {showFilters ? filtersPanel : null}
              {reportQuery.isPlaceholderData ? (
                <div className="p-8 text-sm" role="status">
                  Loading matching results…
                </div>
              ) : tab === "striking" ? (
                <StrikingDistanceTable
                  projectId={projectId}
                  rows={report.strikingDistance}
                  showPage
                  page={page}
                  pageSize={pageSize}
                  onPageChange={(nextPage) =>
                    onSearchChange({ page: nextPage })
                  }
                  onPageSizeChange={(size) =>
                    onSearchChange({ page: undefined, size })
                  }
                  isFiltered={activeFilterCount > 0}
                  onClearFilters={resetFilters}
                />
              ) : isInsightTab ? (
                <InsightTabBody
                  tab={tab}
                  projectId={projectId}
                  filterInput={filterInput}
                  isFiltered={activeFilterCount > 0}
                  onClearFilters={resetFilters}
                />
              ) : (
                <DimensionSection
                  tableQuery={tableQuery}
                  unavailable={
                    <GoogleConnectionCard
                      provider="gsc"
                      projectId={projectId}
                    />
                  }
                  errorFallback="Failed to load Search Console data"
                  emptyState={{
                    title: "No Search Console data yet",
                    description:
                      "Search Console data can take a few days to appear.",
                  }}
                  keyLabel={tab === "queries" ? "Query" : "Page"}
                  showPosition={isWeb}
                  page={page}
                  pageSize={pageSize}
                  onPageChange={(nextPage) =>
                    onSearchChange({ page: nextPage })
                  }
                  onPageSizeChange={(size) =>
                    onSearchChange({ page: undefined, size })
                  }
                  isFiltered={activeFilterCount > 0}
                  onClearFilters={resetFilters}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
