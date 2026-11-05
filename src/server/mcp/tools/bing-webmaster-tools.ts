import { z } from "zod";
import { BingWebmasterService } from "@/server/features/bing-webmaster/services/BingWebmasterService";
import { asAppError } from "@/server/lib/errors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  formatMcpTable,
  percentCell,
  positionCell,
  type McpTableColumn,
} from "@/server/mcp/table";

const BING_SETUP_HINT =
  "Set BING_WEBMASTER_API_KEY (Bing Webmaster Tools → Settings → API access), then recreate the stack.";

const bingOutputSchema = z.looseObject({
  ok: z.boolean(),
  reason: z.string().optional(),
  message: z.string().optional(),
  siteUrl: z.string().optional(),
  sites: z.array(z.string()).optional(),
  ...optionalMetaOutputSchema,
});

const annotations = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
} as const;

type BingContext = {
  baseUrl: string;
  project: { domain: string | null };
};

type BingFailure =
  | { ok: false; reason: "bing_not_configured" }
  | { ok: false; reason: "bing_domain_missing" }
  | { ok: false; reason: "bing_site_not_found"; sites: string[] };

function failureResponse(
  failure: BingFailure,
  meta: ReturnType<typeof buildProjectMeta>,
) {
  if (failure.reason === "bing_not_configured") {
    return mcpResponse({
      text: `Bing Webmaster Tools is not configured on this deployment. ${BING_SETUP_HINT}`,
      meta,
      structuredContent: {
        ok: false,
        reason: failure.reason,
        message: BING_SETUP_HINT,
      },
    });
  }
  if (failure.reason === "bing_domain_missing") {
    return mcpResponse({
      text: "This project has no domain, so no Bing Webmaster site can be matched. Set the project's domain first.",
      meta,
      structuredContent: { ok: false, reason: failure.reason },
    });
  }
  const visible = failure.sites.length > 0 ? failure.sites.join(", ") : "none";
  return mcpResponse({
    text: `No verified Bing Webmaster site matches this project's domain. Sites this API key can see: ${visible}. Add and verify the site in Bing Webmaster Tools (or import it from Google Search Console).`,
    meta,
    structuredContent: {
      ok: false,
      reason: failure.reason,
      sites: failure.sites,
    },
  });
}

/** Run one service call and turn every non-success into a structured result. */
async function runBingTool<T extends { ok: true; siteUrl: string }>(
  context: BingContext,
  projectId: string,
  call: (domain: string | null) => Promise<T | BingFailure>,
  render: (result: T) => { text: string; data: Record<string, unknown> },
) {
  const meta = buildProjectMeta(context, projectId);
  let result: T | BingFailure;
  try {
    result = await call(context.project.domain);
  } catch (error) {
    const appError = asAppError(error);
    if (!appError) throw error;
    return mcpResponse({
      text: appError.message,
      meta,
      structuredContent: {
        ok: false,
        reason: "bing_api_error",
        code: appError.code,
        message: appError.message,
      },
    });
  }
  if (!result.ok) return failureResponse(result, meta);

  const { text, data } = render(result);
  return mcpResponse({
    text,
    meta,
    structuredContent: { ok: true, siteUrl: result.siteUrl, ...data },
  });
}

function dateRangeText(start: string | null, end: string | null) {
  return start && end ? `${start}→${end}` : "no data";
}

// ---------------------------------------------------------------------------
// get_bing_search_performance
// ---------------------------------------------------------------------------

type PerformanceRow = {
  key: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avgImpressionPosition: number | null;
  weeks: number;
};

const PERFORMANCE_COLUMNS: McpTableColumn<PerformanceRow>[] = [
  { header: "key", value: (row) => row.key },
  { header: "clicks", value: (row) => row.clicks },
  { header: "impressions", value: (row) => row.impressions },
  { header: "CTR", value: (row) => row.ctr, format: percentCell },
  {
    header: "position",
    value: (row) => row.avgImpressionPosition,
    format: positionCell,
  },
];

const performanceInputSchema = {
  projectId: projectIdSchema,
  dimension: z
    .enum(["query", "page"])
    .optional()
    .describe("Group by search query (default) or by page URL."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Rows to return (default 100, max 1000)."),
  minImpressions: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Keep rows with at least this many impressions."),
} as const;

export const getBingSearchPerformanceTool = {
  name: "get_bing_search_performance",
  config: {
    title: "Get Bing search performance",
    description:
      "Bing Webmaster Tools search performance for the project's domain: clicks, impressions, CTR and average position per query or page. Bing reports weekly rows; they are summed per key over the available window (ctr is a 0-1 fraction, positions are impression-weighted averages). Sorted by clicks, then impressions. Uses the deployment-wide BING_WEBMASTER_API_KEY and the verified Bing site matching the project's domain. Read-only; uses no credits.",
    inputSchema: performanceInputSchema,
    outputSchema: bingOutputSchema,
    annotations,
  },
  handler: withMcpProjectAuth(
    async (
      args: z.infer<z.ZodObject<typeof performanceInputSchema>>,
      context,
    ) =>
      runBingTool(
        context,
        args.projectId,
        (domain) =>
          BingWebmasterService.getSearchPerformance(domain, {
            dimension: args.dimension ?? "query",
            limit: args.limit ?? 100,
            minImpressions: args.minImpressions,
          }),
        (result) => {
          const header =
            `${result.siteUrl} · Bing by ${result.dimension} · ${dateRangeText(result.startDate, result.endDate)} · ` +
            `${result.totals.clicks} clicks, ${result.totals.impressions} impressions · ` +
            `${result.rows.length} of ${result.matchingRowCount} rows`;
          return {
            text:
              result.rows.length > 0
                ? `${header}\n${formatMcpTable(result.rows, PERFORMANCE_COLUMNS)}`
                : `${header}\nNo rows for this site.`,
            data: {
              dimension: result.dimension,
              startDate: result.startDate,
              endDate: result.endDate,
              matchingRowCount: result.matchingRowCount,
              rows: result.rows,
              totals: result.totals,
            },
          };
        },
      ),
  ),
};

// ---------------------------------------------------------------------------
// get_bing_traffic_trend
// ---------------------------------------------------------------------------

const trendInputSchema = {
  projectId: projectIdSchema,
  days: z
    .number()
    .int()
    .min(1)
    .max(180)
    .optional()
    .describe("Number of most recent available days (default 28, max 180)."),
} as const;

export const getBingTrafficTrendTool = {
  name: "get_bing_traffic_trend",
  config: {
    title: "Get Bing traffic trend",
    description:
      "Daily Bing impressions, clicks and CTR (0-1 fraction) for the project's domain over the last N available days, plus totals. Uses the deployment-wide BING_WEBMASTER_API_KEY. Read-only; uses no credits.",
    inputSchema: trendInputSchema,
    outputSchema: bingOutputSchema,
    annotations,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof trendInputSchema>>, context) =>
      runBingTool(
        context,
        args.projectId,
        (domain) =>
          BingWebmasterService.getTrafficTrend(domain, {
            days: args.days ?? 28,
          }),
        (result) => {
          const first = result.rows[0]?.date ?? null;
          const last = result.rows.at(-1)?.date ?? null;
          return {
            text:
              `${result.siteUrl} · Bing traffic · ${dateRangeText(first, last)} · ${result.rows.length} days · ` +
              `${result.totals.clicks} clicks, ${result.totals.impressions} impressions, CTR ${percentCell(result.totals.ctr)}`,
            data: { rows: result.rows, totals: result.totals },
          };
        },
      ),
  ),
};

// ---------------------------------------------------------------------------
// get_bing_crawl_health
// ---------------------------------------------------------------------------

const crawlInputSchema = {
  projectId: projectIdSchema,
  issueLimit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe(
      "Crawl issues to return, most linked first (default 50, max 500).",
    ),
} as const;

export const getBingCrawlHealthTool = {
  name: "get_bing_crawl_health",
  config: {
    title: "Get Bing crawl health",
    description:
      "Bing crawl health for the project's domain: the latest crawl-stats day (crawled pages, errors, indexed pages, inbound links), 30-day sums of crawled pages and HTTP status classes, and crawl issues (url, httpCode, inLinks, decoded issue names such as Code4xx, BlockedByRobotsTxt, DnsErrors) sorted by inLinks. Uses the deployment-wide BING_WEBMASTER_API_KEY. Read-only; uses no credits.",
    inputSchema: crawlInputSchema,
    outputSchema: bingOutputSchema,
    annotations,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof crawlInputSchema>>, context) =>
      runBingTool(
        context,
        args.projectId,
        (domain) =>
          BingWebmasterService.getCrawlHealth(domain, {
            issueLimit: args.issueLimit ?? 50,
          }),
        (result) => {
          const { latest, last30Days } = result;
          const latestText = latest
            ? `latest ${latest.date}: ${latest.crawledPages} crawled, ${latest.crawlErrors} errors, ${latest.inIndex} indexed`
            : "no crawl stats";
          const issueLines = result.issues
            .slice(0, 10)
            .map(
              (issue) =>
                `${issue.url} · ${issue.httpCode} · ${issue.inLinks} links · ${issue.issues.join(", ") || "-"}`,
            );
          return {
            text: [
              `${result.siteUrl} · Bing crawl health · ${latestText}`,
              `Last ${last30Days.days} days: ${last30Days.crawledPages} crawled, ${last30Days.crawlErrors} errors, ${last30Days.code4xx} 4xx, ${last30Days.code5xx} 5xx, ${last30Days.blockedByRobotsTxt} blocked by robots.txt`,
              `${result.issueCount} crawl issues${issueLines.length > 0 ? " (top by inbound links):" : ""}`,
              ...issueLines,
            ].join("\n"),
            data: {
              latest,
              last30Days,
              issueCount: result.issueCount,
              issues: result.issues,
            },
          };
        },
      ),
  ),
};
