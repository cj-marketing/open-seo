import { queryOptions } from "@tanstack/react-query";
import type { z } from "zod";
import type { DimensionTableResult } from "@/client/features/search-performance/SearchPerformanceColumns";
import { getBingCrawl, getBingTable } from "@/serverFunctions/bingWebmaster";
import type { bingReportInputSchema } from "@/types/schemas/bing-webmaster";
import type { SearchPerformanceTableDimension } from "@/types/schemas/search-performance";

type BingFilterInput = Omit<z.infer<typeof bingReportInputSchema>, "projectId">;

// Upstream failures arrive as a status, not a throw; rethrow them so the
// shared table section shows its error card with retry.
export function bingTableQueryOptions(
  projectId: string,
  dimension: SearchPerformanceTableDimension,
  page: number,
  pageSize: number,
  filterInput: BingFilterInput,
) {
  return queryOptions({
    queryKey: ["bingTable", projectId, dimension, page, pageSize, filterInput],
    queryFn: async (): Promise<DimensionTableResult> => {
      const result = await getBingTable({
        data: { projectId, dimension, page, pageSize, ...filterInput },
      });
      if (result.status === "error") throw new Error(result.code);
      if (result.status !== "ok") return { connected: false };
      return {
        connected: true,
        rows: result.rows,
        totalCount: result.totalCount,
        hasNextPage: result.hasNextPage,
      };
    },
  });
}

export function bingCrawlQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["bingCrawl", projectId],
    queryFn: async () => {
      const result = await getBingCrawl({ data: { projectId } });
      if (result.status === "error") throw new Error(result.code);
      return result.status === "ok" ? result.crawl : null;
    },
  });
}
