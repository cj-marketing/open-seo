import { ProjectChangeNoteService } from "@/server/features/project-context/services/ProjectChangeNoteService";
import { computeImpactWindows } from "@/server/features/gsc/changeNoteImpact";
import {
  resolveDateRange,
  type GscPerformanceFilter,
} from "@/server/features/gsc/searchAnalytics";
import { topGainsAndLosses } from "@/server/features/gsc/searchInsights";
import { sumSearchTotals } from "@/server/features/gsc/searchPerformanceReport";
import { GscService } from "@/server/features/gsc/services/GscService";

// One row per page. The longest window is 28 days, so this holds every page of
// all but very large sites.
const PAGE_ROW_LIMIT = 25000;
const DAILY_ROW_LIMIT = 100;
const TOP_PAGE_LIMIT = 10;

async function loadWindow(
  projectId: string,
  window: { startDate: string; endDate: string },
  filters: GscPerformanceFilter[],
) {
  const [days, pages] = await Promise.all([
    GscService.getPerformance({
      projectId,
      ...window,
      dimensions: ["date"],
      filters,
      rowLimit: DAILY_ROW_LIMIT,
    }),
    GscService.getPerformance({
      projectId,
      ...window,
      dimensions: ["page"],
      filters,
      rowLimit: PAGE_ROW_LIMIT,
    }),
  ]);
  return {
    ...window,
    totals: sumSearchTotals(days.rows),
    pageRows: pages.rows,
  };
}

/**
 * Search Console before/after for one change note: the same number of days
 * either side of the day it went live, optionally limited to URLs containing
 * `pageContains`. Throws the GSC errors (not connected, expired grant) for the
 * caller to present.
 */
async function getImpact(
  projectId: string,
  input: { noteId: string; windowDays: number; pageContains?: string },
) {
  const note = await ProjectChangeNoteService.getNote(projectId, input.noteId);
  const latestDate = resolveDateRange({ dateRange: "last_7_days" }).endDate;
  const earliestDate = resolveDateRange({
    startDate: "1970-01-01",
    endDate: latestDate,
  }).startDate;
  const windows = computeImpactWindows({
    noteDate: note.noteDate,
    windowDays: input.windowDays,
    latestDate,
    earliestDate,
  });
  const base = {
    note,
    windowDays: input.windowDays,
    pageContains: input.pageContains ?? null,
    latestDate,
  };
  if (windows.status === "no_after_data") {
    return { ...base, status: "no_after_data" as const };
  }
  if (windows.status === "no_before_data") {
    return { ...base, status: "no_before_data" as const };
  }

  const filters: GscPerformanceFilter[] = input.pageContains
    ? [
        {
          dimension: "page",
          operator: "contains",
          expression: input.pageContains,
        },
      ]
    : [];
  const [before, after] = await Promise.all([
    loadWindow(projectId, windows.before, filters),
    loadWindow(projectId, windows.after, filters),
  ]);
  const { gains, losses } = topGainsAndLosses(
    before.pageRows,
    after.pageRows,
    TOP_PAGE_LIMIT,
  );
  return {
    ...base,
    status: "ok" as const,
    comparedDays: windows.comparedDays,
    before: {
      startDate: before.startDate,
      endDate: before.endDate,
      totals: before.totals,
    },
    after: {
      startDate: after.startDate,
      endDate: after.endDate,
      totals: after.totals,
    },
    topGains: gains,
    topLosses: losses,
  };
}

export const ChangeNoteImpactService = { getImpact } as const;
