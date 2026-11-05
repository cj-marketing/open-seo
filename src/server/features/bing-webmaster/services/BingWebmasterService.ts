import { sortBy } from "remeda";
import type { z } from "zod";
import {
  isStrikingDistancePosition,
  STRIKING_DISTANCE_ROW_LIMIT,
} from "@/server/features/gsc/searchPerformanceReport";
import {
  bingRequest,
  crawlIssuesSchema,
  crawlStatsSchema,
  statsRowsSchema,
  trafficSchema,
  withSite,
} from "./bingApi";

const CRAWL_SUM_DAYS = 30;

// Bit flags of GetCrawlIssues `Issues`.
const CRAWL_ISSUE_FLAGS = [
  [1, "Code301"],
  [2, "Code302"],
  [4, "Code4xx"],
  [8, "Code5xx"],
  [16, "BlockedByRobotsTxt"],
  [32, "ContainsMalware"],
  [64, "ImportantUrlBlockedByRobotsTxt"],
  [128, "DnsErrors"],
  [256, "TimeOutErrors"],
] as const;

type DateWindow = { startDate: string; endDate: string };
type TextFilter = { operator: "contains" | "equals"; expression: string };

function ratio(clicks: number, impressions: number): number {
  return impressions > 0 ? clicks / impressions : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Weighted mean of positions; rows with weight 0 do not count, and neither do
 * rows without a position (Bing reports AvgClickPosition -1 when it has none).
 * Null when nothing is left.
 */
function weightedMean(
  rows: { value: number; weight: number }[],
): number | null {
  const valid = rows.filter((row) => row.value > 0);
  const weight = sum(valid.map((row) => row.weight));
  if (weight === 0) return null;
  return sum(valid.map((row) => row.value * row.weight)) / weight;
}

function decodeCrawlIssues(flags: number): string[] {
  return CRAWL_ISSUE_FLAGS.filter(([bit]) => (flags & bit) !== 0).map(
    ([, name]) => name,
  );
}

function inWindow(date: string, window: DateWindow | undefined): boolean {
  return !window || (date >= window.startDate && date <= window.endDate);
}

/** "contains" ignores case; "equals" compares exactly, like the GSC filters. */
function matchesFilter(key: string, filter: TextFilter | undefined): boolean {
  if (!filter) return true;
  return filter.operator === "equals"
    ? key === filter.expression
    : key.toLowerCase().includes(filter.expression.toLowerCase());
}

const NO_TOTALS = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

function aggregateWeeklyRows(rows: z.infer<typeof statsRowsSchema>["d"]) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = groups.get(row.Query);
    if (group) group.push(row);
    else groups.set(row.Query, [row]);
  }
  return [...groups].map(([key, group]) => {
    const impressions = sum(group.map((row) => row.Impressions));
    const clicks = sum(group.map((row) => row.Clicks));
    return {
      key,
      impressions,
      clicks,
      ctr: ratio(clicks, impressions),
      avgImpressionPosition: weightedMean(
        group.map((row) => ({
          value: row.AvgImpressionPosition,
          weight: row.Impressions,
        })),
      ),
      // Weeks without clicks carry no click position, so weight by clicks.
      avgClickPosition: weightedMean(
        group.map((row) => ({
          value: row.AvgClickPosition,
          weight: row.Clicks,
        })),
      ),
      weeks: group.length,
    };
  });
}

export const BingWebmasterService = {
  async getSearchPerformance(
    domain: string | null,
    input: {
      dimension: "query" | "page";
      limit: number;
      /** Rows to skip before `limit`, for paging. */
      offset?: number;
      minImpressions?: number;
      /** Only weekly rows whose Date falls inside the window count. */
      window?: DateWindow;
      /** Keeps only keys (query or page) matching the filter. */
      filter?: TextFilter;
    },
  ) {
    return withSite(domain, async (siteUrl, apiKey) => {
      const method =
        input.dimension === "page" ? "GetPageStats" : "GetQueryStats";
      const { d: allWeeks } = await bingRequest(
        method,
        apiKey,
        { siteUrl },
        statsRowsSchema,
      );
      const weekly = allWeeks.filter(
        (row) =>
          inWindow(row.Date, input.window) &&
          matchesFilter(row.Query, input.filter),
      );
      const dates = sortBy(weekly, (row) => row.Date).map((row) => row.Date);
      const minImpressions = input.minImpressions ?? 0;
      const rows = sortBy(
        aggregateWeeklyRows(weekly).filter(
          (row) => row.impressions >= minImpressions,
        ),
        [(row) => row.clicks, "desc"],
        [(row) => row.impressions, "desc"],
      );
      const impressions = sum(weekly.map((row) => row.Impressions));
      const clicks = sum(weekly.map((row) => row.Clicks));
      return {
        ok: true as const,
        siteUrl,
        dimension: input.dimension,
        startDate: dates[0] ?? null,
        endDate: dates.at(-1) ?? null,
        matchingRowCount: rows.length,
        rows: rows.slice(input.offset ?? 0, (input.offset ?? 0) + input.limit),
        totals: { impressions, clicks, ctr: ratio(clicks, impressions) },
      };
    });
  },

  /**
   * Totals for a window and the window before it (daily traffic, plus an
   * impression-weighted position from the weekly query rows), and the
   * striking-distance queries of the window. The previous window counts as
   * unavailable (all zeros) when Bing's daily history does not reach back to
   * its start, so a partial period is never compared with a full one.
   */
  async getReport(
    domain: string | null,
    input: {
      window: DateWindow;
      previousWindow: DateWindow;
      queryFilter?: TextFilter;
    },
  ) {
    return withSite(domain, async (siteUrl, apiKey) => {
      const [{ d: daily }, { d: weekly }] = await Promise.all([
        bingRequest(
          "GetRankAndTrafficStats",
          apiKey,
          { siteUrl },
          trafficSchema,
        ),
        bingRequest("GetQueryStats", apiKey, { siteUrl }, statsRowsSchema),
      ]);
      const earliestDay = sortBy(daily, (row) => row.Date)[0]?.Date;

      const totalsFor = (window: DateWindow) => {
        const days = daily.filter((row) => inWindow(row.Date, window));
        const clicks = sum(days.map((row) => row.Clicks));
        const impressions = sum(days.map((row) => row.Impressions));
        const position = weightedMean(
          weekly
            .filter((row) => inWindow(row.Date, window))
            .map((row) => ({
              value: row.AvgImpressionPosition,
              weight: row.Impressions,
            })),
        );
        return {
          clicks,
          impressions,
          ctr: ratio(clicks, impressions),
          position: position ?? 0,
        };
      };

      const hasPreviousHistory =
        earliestDay !== undefined &&
        earliestDay <= input.previousWindow.startDate;

      const strikingDistance = sortBy(
        aggregateWeeklyRows(
          weekly.filter(
            (row) =>
              inWindow(row.Date, input.window) &&
              matchesFilter(row.Query, input.queryFilter),
          ),
        ).flatMap((row) =>
          row.avgImpressionPosition !== null &&
          isStrikingDistancePosition(row.avgImpressionPosition)
            ? [
                {
                  query: row.key,
                  impressions: row.impressions,
                  clicks: row.clicks,
                  position: row.avgImpressionPosition,
                },
              ]
            : [],
        ),
        [(row) => row.impressions, "desc"],
      ).slice(0, STRIKING_DISTANCE_ROW_LIMIT);

      return {
        ok: true as const,
        siteUrl,
        totals: totalsFor(input.window),
        prevTotals: hasPreviousHistory
          ? totalsFor(input.previousWindow)
          : NO_TOTALS,
        strikingDistance,
      };
    });
  },

  async getTrafficTrend(domain: string | null, input: { days: number }) {
    return withSite(domain, async (siteUrl, apiKey) => {
      const { d: daily } = await bingRequest(
        "GetRankAndTrafficStats",
        apiKey,
        { siteUrl },
        trafficSchema,
      );
      const rows = sortBy(daily, (row) => row.Date)
        .slice(-input.days)
        .map((row) => ({
          date: row.Date,
          impressions: row.Impressions,
          clicks: row.Clicks,
          ctr: ratio(row.Clicks, row.Impressions),
        }));
      const impressions = sum(rows.map((row) => row.impressions));
      const clicks = sum(rows.map((row) => row.clicks));
      return {
        ok: true as const,
        siteUrl,
        rows,
        totals: { impressions, clicks, ctr: ratio(clicks, impressions) },
      };
    });
  },

  async getCrawlHealth(domain: string | null, input: { issueLimit: number }) {
    return withSite(domain, async (siteUrl, apiKey) => {
      const [stats, issues] = await Promise.all([
        bingRequest("GetCrawlStats", apiKey, { siteUrl }, crawlStatsSchema),
        bingRequest("GetCrawlIssues", apiKey, { siteUrl }, crawlIssuesSchema),
      ]);
      const days = sortBy(stats.d, [(day) => day.Date, "desc"]);
      const recent = days.slice(0, CRAWL_SUM_DAYS);
      const total = (pick: (day: (typeof days)[number]) => number) =>
        sum(recent.map(pick));
      const [latest] = days;
      return {
        ok: true as const,
        siteUrl,
        latest: latest
          ? {
              date: latest.Date,
              crawledPages: latest.CrawledPages,
              crawlErrors: latest.CrawlErrors,
              inIndex: latest.InIndex,
              inLinks: latest.InLinks,
            }
          : null,
        last30Days: {
          days: recent.length,
          crawledPages: total((day) => day.CrawledPages),
          crawlErrors: total((day) => day.CrawlErrors),
          code2xx: total((day) => day.Code2xx),
          code301: total((day) => day.Code301),
          code302: total((day) => day.Code302),
          code4xx: total((day) => day.Code4xx),
          code5xx: total((day) => day.Code5xx),
          allOtherCodes: total((day) => day.AllOtherCodes),
          blockedByRobotsTxt: total((day) => day.BlockedByRobotsTxt),
          containsMalware: total((day) => day.ContainsMalware),
        },
        issueCount: issues.d.length,
        issues: sortBy(issues.d, [(issue) => issue.InLinks, "desc"])
          .slice(0, input.issueLimit)
          .map((issue) => ({
            url: issue.Url,
            httpCode: issue.HttpCode,
            inLinks: issue.InLinks,
            issues: decodeCrawlIssues(issue.Issues),
          })),
      };
    });
  },
};
