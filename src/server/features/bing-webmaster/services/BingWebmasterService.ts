import { sortBy } from "remeda";
import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

const BING_API_BASE = "https://ssl.bing.com/webmaster/api.svc/json";
const BING_TIMEOUT_MS = 15_000;
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

// "/Date(1316156400000-0700)/": the number is UTC epoch ms, the offset is
// optional and informational only.
const bingDateSchema = z.string().transform((value, ctx) => {
  const match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (!match) {
    ctx.addIssue({ code: "custom", message: "Unrecognized Bing date" });
    return z.NEVER;
  }
  return new Date(Number(match[1])).toISOString().slice(0, 10);
});

// Bing sometimes sends null for a count or position it has no value for;
// treat that as 0 rather than rejecting the whole response.
const bingNumber = z
  .number()
  .nullish()
  .transform((value) => value ?? 0);

const userSitesSchema = z.object({
  d: z.array(z.object({ Url: z.string(), IsVerified: z.boolean() })),
});

const statsRowsSchema = z.object({
  d: z.array(
    z.object({
      Query: z.string(),
      Impressions: bingNumber,
      Clicks: bingNumber,
      AvgImpressionPosition: bingNumber,
      AvgClickPosition: bingNumber,
      Date: bingDateSchema,
    }),
  ),
});

const trafficSchema = z.object({
  d: z.array(
    z.object({
      Date: bingDateSchema,
      Impressions: bingNumber,
      Clicks: bingNumber,
    }),
  ),
});

const crawlStatsSchema = z.object({
  d: z.array(
    z.object({
      Date: bingDateSchema,
      CrawledPages: bingNumber,
      CrawlErrors: bingNumber,
      InIndex: bingNumber,
      InLinks: bingNumber,
      Code2xx: bingNumber,
      Code301: bingNumber,
      Code302: bingNumber,
      Code4xx: bingNumber,
      Code5xx: bingNumber,
      AllOtherCodes: bingNumber,
      BlockedByRobotsTxt: bingNumber,
      ContainsMalware: bingNumber,
    }),
  ),
});

const crawlIssuesSchema = z.object({
  d: z.array(
    z.object({
      Url: z.string(),
      HttpCode: bingNumber,
      Issues: bingNumber,
      InLinks: bingNumber,
    }),
  ),
});

const bingErrorSchema = z.object({
  ErrorCode: z.number().optional(),
  Message: z.string().optional(),
});

type SiteFailure =
  | { ok: false; reason: "bing_not_configured" }
  | { ok: false; reason: "bing_domain_missing" }
  | { ok: false; reason: "bing_site_not_found"; sites: string[] };

function hostOf(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./, "");
}

function ratio(clicks: number, impressions: number): number {
  return impressions > 0 ? clicks / impressions : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Weighted mean; rows with weight 0 do not count. Null when no weight at all. */
function weightedMean(
  rows: { value: number; weight: number }[],
): number | null {
  const weight = sum(rows.map((row) => row.weight));
  if (weight === 0) return null;
  return sum(rows.map((row) => row.value * row.weight)) / weight;
}

function decodeCrawlIssues(flags: number): string[] {
  return CRAWL_ISSUE_FLAGS.filter(([bit]) => (flags & bit) !== 0).map(
    ([, name]) => name,
  );
}

// The key travels in the query string, so nothing here may log or return the
// URL: only the method name and HTTP status appear in logs and messages.
async function bingRequest<T>(
  method: string,
  apiKey: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  const url = new URL(`${BING_API_BASE}/${method}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("apikey", apiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(BING_TIMEOUT_MS),
    });
  } catch {
    console.warn(`Bing Webmaster ${method} request failed (network/timeout)`);
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Bing Webmaster ${method} did not respond.`,
    );
  }

  if (!response.ok) {
    const body = bingErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    const detail = body.success ? body.data : {};
    console.warn(`Bing Webmaster ${method} failed (${response.status})`);
    if (detail.Message === "InvalidApiKey") {
      throw new AppError(
        "VALIDATION_ERROR",
        "Bing rejected BING_WEBMASTER_API_KEY (InvalidApiKey). Create a new key in Bing Webmaster Tools → Settings → API access.",
      );
    }
    const code =
      response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_UNAVAILABLE";
    const suffix = detail.Message ? `: ${detail.Message}` : "";
    throw new AppError(
      code,
      `Bing Webmaster ${method} failed (${response.status})${suffix}.`,
    );
  }

  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    console.warn(`Bing Webmaster ${method} returned an unexpected response`);
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Bing Webmaster ${method} returned an unexpected response.`,
    );
  }
  return parsed.data;
}

async function withSite<T>(
  domain: string | null,
  run: (siteUrl: string, apiKey: string) => Promise<T>,
): Promise<T | SiteFailure> {
  const apiKey = (await getOptionalEnvValue("BING_WEBMASTER_API_KEY"))?.trim();
  if (!apiKey) return { ok: false, reason: "bing_not_configured" };
  if (!domain) return { ok: false, reason: "bing_domain_missing" };

  const { d: sites } = await bingRequest(
    "GetUserSites",
    apiKey,
    {},
    userSitesSchema,
  );
  const host = hostOf(domain);
  const matches = sites.filter(
    (site) => site.IsVerified && hostOf(site.Url) === host,
  );
  const site =
    matches.find((candidate) => candidate.Url.startsWith("https://")) ??
    matches[0];
  if (!site) {
    return {
      ok: false,
      reason: "bing_site_not_found",
      sites: sites.map((candidate) => candidate.Url),
    };
  }
  return run(site.Url, apiKey);
}

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
      minImpressions?: number;
    },
  ) {
    return withSite(domain, async (siteUrl, apiKey) => {
      const method =
        input.dimension === "page" ? "GetPageStats" : "GetQueryStats";
      const { d: weekly } = await bingRequest(
        method,
        apiKey,
        { siteUrl },
        statsRowsSchema,
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
        rows: rows.slice(0, input.limit),
        totals: { impressions, clicks, ctr: ratio(clicks, impressions) },
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
