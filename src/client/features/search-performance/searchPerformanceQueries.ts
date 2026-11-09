import { queryOptions } from "@tanstack/react-query";
import type { z } from "zod";
import { getSearchPerformanceTable } from "@/serverFunctions/searchPerformance";
import type {
  searchPerformanceInputSchema,
  SearchPerformanceSearch,
  SearchPerformanceTab,
  SearchPerformanceTableDimension,
} from "@/types/schemas/search-performance";

export type FilterInput = Omit<
  z.infer<typeof searchPerformanceInputSchema>,
  "projectId"
>;

// Shared by the live table and prefetch so the query key and request agree.
export function tableQueryOptions(
  projectId: string,
  dimension: SearchPerformanceTableDimension,
  page: number,
  pageSize: number,
  filterInput: FilterInput,
) {
  return queryOptions({
    queryKey: [
      "searchPerformanceTable",
      projectId,
      dimension,
      page,
      pageSize,
      filterInput,
    ],
    queryFn: () =>
      getSearchPerformanceTable({
        data: { projectId, dimension, page, pageSize, ...filterInput },
      }),
  });
}

export function tabDimension(
  tab: SearchPerformanceTab,
): SearchPerformanceTableDimension {
  return tab === "pages" ? "page" : "query";
}

export function buildFilterInput({
  type = "web",
  range = "last_28_days",
  device,
  country,
}: Pick<
  SearchPerformanceSearch,
  "type" | "range" | "device" | "country"
>): FilterInput {
  return {
    searchType: type,
    dateRange: range,
    ...(device ? { device } : {}),
    ...(country ? { country } : {}),
  };
}
