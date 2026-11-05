import { createServerFn } from "@tanstack/react-start";
import { resolveDateRange } from "@/server/features/gsc/searchAnalytics";
import { previousPeriod } from "@/server/features/gsc/searchPerformanceReport";
import { BingWebmasterService } from "@/server/features/bing-webmaster/services/BingWebmasterService";
import { asAppError } from "@/server/lib/errors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  bingCrawlInputSchema,
  bingReportInputSchema,
  bingTableExportInputSchema,
  bingTableInputSchema,
} from "@/types/schemas/bing-webmaster";
import type { SearchPerformanceDateRange } from "@/types/schemas/search-performance";

const CRAWL_ISSUE_LIMIT = 50;
// Bing returns every row at once; the export is capped like Search Console's.
const EXPORT_ROW_LIMIT = 1000;

type ServiceFailure = Extract<
  Awaited<ReturnType<typeof BingWebmasterService.getReport>>,
  { ok: false }
>;

/** The expected "Bing can't answer for this project" cases, as UI statuses. */
function toFailureStatus(failure: ServiceFailure) {
  switch (failure.reason) {
    case "bing_not_configured":
      return { status: "not_configured" as const };
    case "bing_domain_missing":
      return { status: "domain_missing" as const };
    case "bing_site_not_found":
      return { status: "site_not_found" as const, sites: failure.sites };
  }
}

/** Upstream failures (bad key, rate limit, Bing down) render as an error card;
 *  anything else is a real fault and propagates. */
function toErrorStatus(error: unknown) {
  const appError = asAppError(error);
  if (!appError) throw error;
  return { status: "error" as const, code: appError.code };
}

/** The same windows the Search Console page uses for a date range option. */
function resolveRange(dateRange: SearchPerformanceDateRange) {
  const { startDate, endDate } = resolveDateRange({ dateRange });
  const prev = previousPeriod(startDate, endDate);
  return {
    startDate,
    endDate,
    prevStartDate: prev.startDate,
    prevEndDate: prev.endDate,
  };
}

/**
 * Totals with the previous period, and the striking-distance queries. Totals
 * are site-wide: Bing's daily traffic cannot be filtered by query or page.
 * Free first-party data from the deployment-wide Bing key.
 */
export const getBingReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingReportInputSchema)
  .handler(async ({ data, context }) => {
    const range = resolveRange(data.dateRange);
    try {
      const result = await BingWebmasterService.getReport(
        context.project.domain,
        {
          window: range,
          previousWindow: {
            startDate: range.prevStartDate,
            endDate: range.prevEndDate,
          },
          queryFilter: data.queryFilter,
        },
      );
      if (!result.ok) return toFailureStatus(result);
      return {
        status: "ok" as const,
        siteUrl: result.siteUrl,
        range,
        totals: result.totals,
        prevTotals: result.prevTotals,
        strikingDistance: result.strikingDistance,
      };
    } catch (error) {
      return toErrorStatus(error);
    }
  });

/** The row shape of the shared Search Console table. */
function toDimensionRow(row: {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avgImpressionPosition: number | null;
}) {
  return {
    key: row.key,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.avgImpressionPosition ?? 0,
  };
}

/** One page of the Queries or Pages table. Bing returns every row in one call, so paging happens in the service. */
export const getBingTable = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingTableInputSchema)
  .handler(async ({ data, context }) => {
    const offset = (data.page - 1) * data.pageSize;
    try {
      const result = await BingWebmasterService.getSearchPerformance(
        context.project.domain,
        {
          dimension: data.dimension,
          limit: data.pageSize,
          offset,
          window: resolveRange(data.dateRange),
          filter:
            data.dimension === "page" ? data.pageFilter : data.queryFilter,
        },
      );
      if (!result.ok) return toFailureStatus(result);
      return {
        status: "ok" as const,
        hasNextPage: offset + data.pageSize < result.matchingRowCount,
        totalCount: result.matchingRowCount,
        rows: result.rows.map(toDimensionRow),
      };
    } catch (error) {
      return toErrorStatus(error);
    }
  });

/** The full Queries or Pages dataset for CSV/Sheets export, capped at EXPORT_ROW_LIMIT. */
export const exportBingTable = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingTableExportInputSchema)
  .handler(async ({ data, context }) => {
    const result = await BingWebmasterService.getSearchPerformance(
      context.project.domain,
      {
        dimension: data.dimension,
        limit: EXPORT_ROW_LIMIT,
        window: resolveRange(data.dateRange),
        filter: data.dimension === "page" ? data.pageFilter : data.queryFilter,
      },
    );
    return { rows: result.ok ? result.rows.map(toDimensionRow) : [] };
  });

/** Crawl health for the Crawl tab: latest day, 30-day status breakdown and crawl issues. */
export const getBingCrawl = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingCrawlInputSchema)
  .handler(async ({ context }) => {
    try {
      const crawl = await BingWebmasterService.getCrawlHealth(
        context.project.domain,
        { issueLimit: CRAWL_ISSUE_LIMIT },
      );
      if (!crawl.ok) return toFailureStatus(crawl);
      return { status: "ok" as const, crawl };
    } catch (error) {
      return toErrorStatus(error);
    }
  });
