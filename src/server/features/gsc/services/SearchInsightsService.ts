import type { GscPerformanceFilter } from "@/server/features/gsc/searchAnalytics";
import {
  buildCannibalizationRows,
  buildDecayRows,
} from "@/server/features/gsc/searchInsights";
import { previousPeriod } from "@/server/features/gsc/searchPerformanceReport";
import { GscService } from "@/server/features/gsc/services/GscService";

// Google's per-call maximum. Decay and cannibalization need the long tail, not
// the top 1,000 rows by clicks.
const INSIGHT_FETCH_LIMIT = 25000;

type InsightInput = {
  projectId: string;
  startDate: string;
  endDate: string;
  filters: GscPerformanceFilter[];
};

/** Pages or queries that lost clicks or impressions against the period right
 *  before the selected one. */
async function getDecay(input: InsightInput & { dimension: "page" | "query" }) {
  const previous = previousPeriod(input.startDate, input.endDate);
  const fetchPeriod = (period: { startDate: string; endDate: string }) =>
    GscService.getPerformance({
      projectId: input.projectId,
      ...period,
      dimensions: [input.dimension],
      filters: input.filters,
      rowLimit: INSIGHT_FETCH_LIMIT,
    });
  const [current, before] = await Promise.all([
    fetchPeriod({ startDate: input.startDate, endDate: input.endDate }),
    fetchPeriod(previous),
  ]);
  return {
    dimension: input.dimension,
    current: { startDate: input.startDate, endDate: input.endDate },
    previous,
    // Google caps a call at 25,000 rows by clicks; a full page means the
    // quietest keys may be missing from either period.
    mayBeIncomplete:
      current.rows.length >= INSIGHT_FETCH_LIMIT ||
      before.rows.length >= INSIGHT_FETCH_LIMIT,
    rows: buildDecayRows(before.rows, current.rows),
  };
}

/** Queries answered by two or more of the site's own pages. */
async function getCannibalization(input: InsightInput) {
  const result = await GscService.getPerformance({
    projectId: input.projectId,
    startDate: input.startDate,
    endDate: input.endDate,
    dimensions: ["query", "page"],
    filters: input.filters,
    rowLimit: INSIGHT_FETCH_LIMIT,
  });
  return {
    current: { startDate: input.startDate, endDate: input.endDate },
    mayBeIncomplete: result.rows.length >= INSIGHT_FETCH_LIMIT,
    rows: buildCannibalizationRows(result.rows),
  };
}

export const SearchInsightsService = { getDecay, getCannibalization } as const;
