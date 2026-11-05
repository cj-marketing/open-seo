import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { TablePagination } from "@/client/components/table/TablePagination";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import type { DimensionTableResult } from "@/client/features/search-performance/SearchPerformanceColumns";
import { DimensionTable } from "@/client/features/search-performance/SearchPerformanceParts";
import { SEARCH_PERFORMANCE_PAGE_SIZES } from "@/types/schemas/search-performance";

/** The Queries or Pages tab body: loading, error with retry, the unavailable card, or the paged table. */
export function DimensionSection({
  tableQuery,
  unavailable,
  errorFallback,
  emptyState,
  keyLabel,
  showPosition,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  isFiltered,
  onClearFilters,
}: {
  tableQuery: UseQueryResult<DimensionTableResult>;
  /** Shown when the source went away after the report loaded (for example a dead Google grant). */
  unavailable: ReactNode;
  errorFallback: string;
  emptyState: { title: string; description: string };
  keyLabel: string;
  showPosition: boolean;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  isFiltered: boolean;
  onClearFilters: () => void;
}) {
  if (tableQuery.isPending) {
    return <SkeletonTableRows className="p-4" />;
  }

  const error = tableQuery.isError ? (
    <div className="px-4 pt-4">
      <QueryError
        error={tableQuery.error}
        fallback={errorFallback}
        onRetry={() => void tableQuery.refetch()}
        isRetrying={tableQuery.isFetching}
      />
    </div>
  ) : null;

  const tableData = tableQuery.data;
  if (!tableData) return <div className="pb-4">{error}</div>;

  if (!tableData.connected) {
    return <div className="max-w-2xl p-4">{unavailable}</div>;
  }

  const isPastEnd =
    page > 1 && tableData.rows.length === 0 && !tableQuery.isPlaceholderData;

  return (
    <>
      {error}
      <div className="p-4">
        <DimensionTable
          rows={tableData.rows}
          keyLabel={keyLabel}
          showPosition={showPosition}
          emptyState={emptyState}
          isFiltered={isFiltered}
          isPastEnd={isPastEnd}
          onClearFilters={onClearFilters}
          onFirstPage={() => onPageChange(1)}
        />
      </div>
      {!isPastEnd && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          pageSizes={SEARCH_PERFORMANCE_PAGE_SIZES}
          totalCount={tableData.totalCount}
          hasNextPage={tableData.hasNextPage}
          isLoading={tableQuery.isFetching}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </>
  );
}
