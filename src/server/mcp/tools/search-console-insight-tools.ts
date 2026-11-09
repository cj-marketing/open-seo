import { z } from "zod";
import { resolveDateRange } from "@/server/features/gsc/searchAnalytics";
import type { GscPerformanceFilter } from "@/server/features/gsc/searchAnalytics";
import { ChangeNoteImpactService } from "@/server/features/gsc/services/ChangeNoteImpactService";
import { SearchInsightsService } from "@/server/features/gsc/services/SearchInsightsService";
import {
  GscApiError,
  GscNotConnectedError,
  GscTokenError,
} from "@/server/lib/gscErrors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable, percentCell, positionCell } from "@/server/mcp/table";
import {
  describeGscError,
  missingSelfHostedGoogleClientResponse,
} from "@/server/mcp/tools/search-console-tools";
import { buildConnectGscUrl } from "@/server/mcp/urls";
import { GSC_SELF_HOSTED_SETUP_DOCS_URL } from "@/shared/gsc";
import {
  CHANGE_NOTE_WINDOW_DAYS,
  changeNoteImpactSchema,
  changeNoteWindowSchema,
} from "@/types/schemas/change-notes";
import { SEARCH_PERFORMANCE_RANGES } from "@/types/schemas/search-performance";

type GscToolContext = Parameters<
  typeof missingSelfHostedGoogleClientResponse
>[0] & { auth: { guestClaimToken?: string | null } };

/** Shared failure answer for the GSC-backed tools below, matching how the
 *  other Search Console tools report "not connected" and an expired grant. */
function gscFailure(
  context: GscToolContext,
  projectId: string,
  error: unknown,
) {
  const connectUrl = buildConnectGscUrl(
    context.baseUrl,
    projectId,
    Boolean(context.auth.guestClaimToken),
  );
  const isNotConnected = error instanceof GscNotConnectedError;
  const apiDisabled = error instanceof GscApiError && error.apiDisabled;
  return mcpResponse({
    text: `${describeGscError(error)}${isNotConnected ? ` Connect it here: ${connectUrl}` : apiDisabled ? ` Setup docs: ${GSC_SELF_HOSTED_SETUP_DOCS_URL}` : ` (reconnect at ${connectUrl})`}`,
    meta: buildProjectMeta(
      context,
      projectId,
      `/p/${projectId}/search-performance`,
    ),
    structuredContent: {
      ok: false,
      reason: isNotConnected ? "not_connected" : "api_error",
      connectionRequired: isNotConnected || error instanceof GscTokenError,
      connectUrl,
    },
  });
}

const pageContainsSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .optional()
  .describe(
    "Only count pages whose URL contains this text, e.g. '/blog/' or one slug.",
  );

function pageFilter(pageContains: string | undefined): GscPerformanceFilter[] {
  return pageContains
    ? [{ dimension: "page", operator: "contains", expression: pageContains }]
    : [];
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

// ---------------------------------------------------------------------------
// get_change_note_impact
// ---------------------------------------------------------------------------

const impactInputSchema = {
  projectId: projectIdSchema,
  noteId: changeNoteImpactSchema.shape.noteId.describe(
    "A change note id from list_change_notes or save_change_note.",
  ),
  windowDays: changeNoteWindowSchema
    .optional()
    .describe(
      `Days compared on each side of the change: ${CHANGE_NOTE_WINDOW_DAYS.join(", ")} (default 28). A recent change has fewer complete days after it; then the same number of days before it are compared and the result says "x of N days".`,
    ),
  pageContains: pageContainsSchema,
} as const;

type ImpactArgs = z.infer<z.ZodObject<typeof impactInputSchema>>;

type PageDelta = {
  key: string;
  beforeClicks: number;
  afterClicks: number;
  beforeImpressions: number;
  afterImpressions: number;
  beforePosition: number | null;
  afterPosition: number | null;
};

const PAGE_DELTA_COLUMNS = [
  { header: "page", value: (row: PageDelta) => row.key },
  {
    header: "clicks",
    value: (row: PageDelta) =>
      `${row.beforeClicks} → ${row.afterClicks} (${signed(row.afterClicks - row.beforeClicks)})`,
  },
  {
    header: "impressions",
    value: (row: PageDelta) =>
      `${row.beforeImpressions} → ${row.afterImpressions} (${signed(row.afterImpressions - row.beforeImpressions)})`,
  },
  {
    header: "position",
    value: (row: PageDelta) =>
      `${positionCell(row.beforePosition ?? undefined)} → ${positionCell(row.afterPosition ?? undefined)}`,
  },
];

export const getChangeNoteImpactTool = {
  name: "get_change_note_impact",
  config: {
    title: "Get change note impact",
    description:
      "Compares Search Console clicks, impressions, CTR and position before and after one change note (see list_change_notes), plus the pages that gained and lost most. 'Before' is the days ending the day before the change; 'after' starts the day after it. Search Console data ends about 3 days back, so a recent change may have only some of the requested days; the result then says 'x of N days' and compares that many days before it. A before/after difference is a correlation, not proof the change caused it. Read-only; uses no credits.",
    inputSchema: impactInputSchema,
    outputSchema: z.looseObject({
      ok: z.boolean(),
      reason: z.string().optional(),
      connectionRequired: z.boolean().optional(),
      connectUrl: z.string().optional(),
      impact: looseObjectOutputSchema.optional(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: ImpactArgs, context) => {
    const blocked = await missingSelfHostedGoogleClientResponse(
      context,
      args.projectId,
    );
    if (blocked) return blocked;
    try {
      const impact = await ChangeNoteImpactService.getImpact(args.projectId, {
        noteId: args.noteId,
        windowDays: args.windowDays ?? 28,
        pageContains: args.pageContains,
      });
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/search-performance`,
      );
      const heading = `Change on ${impact.note.noteDate}: ${impact.note.label}`;
      if (impact.status === "no_after_data") {
        return mcpResponse({
          text: `${heading}\nNo complete Search Console days after this change yet (data ends ${impact.latestDate}). Check again in a few days.`,
          meta,
          structuredContent: { ok: true, impact },
        });
      }
      if (impact.status === "no_before_data") {
        return mcpResponse({
          text: `${heading}\nThis change is older than the 16 months Search Console keeps, so there is no before period to compare.`,
          meta,
          structuredContent: { ok: true, impact },
        });
      }
      const rows = [
        ["clicks", impact.before.totals.clicks, impact.after.totals.clicks],
        [
          "impressions",
          impact.before.totals.impressions,
          impact.after.totals.impressions,
        ],
        ["CTR", impact.before.totals.ctr, impact.after.totals.ctr],
        [
          "position",
          impact.before.totals.position,
          impact.after.totals.position,
        ],
      ] as const;
      const formatMetric = (name: string, value: number) =>
        name === "CTR"
          ? percentCell(value)
          : name === "position"
            ? positionCell(value)
            : String(Math.round(value));
      const text = [
        heading,
        `Compared ${impact.comparedDays} of ${impact.windowDays} days after the change against the ${impact.comparedDays} days before it${impact.pageContains ? ` · pages containing "${impact.pageContains}"` : ""}.`,
        `Before ${impact.before.startDate} → ${impact.before.endDate}; after ${impact.after.startDate} → ${impact.after.endDate}.`,
        formatMcpTable(rows, [
          { header: "metric", value: (row) => row[0] },
          {
            header: "before",
            value: (row) => formatMetric(row[0], row[1]),
          },
          {
            header: "after",
            value: (row) => formatMetric(row[0], row[2]),
          },
        ]),
        impact.topGains.length > 0
          ? `Top gains:\n${formatMcpTable(impact.topGains, PAGE_DELTA_COLUMNS)}`
          : "No pages gained.",
        impact.topLosses.length > 0
          ? `Top losses:\n${formatMcpTable(impact.topLosses, PAGE_DELTA_COLUMNS)}`
          : "No pages lost.",
      ].join("\n\n");
      return mcpResponse({
        text,
        meta,
        structuredContent: { ok: true, impact },
      });
    } catch (error) {
      return gscFailure(context, args.projectId, error);
    }
  }),
};

// ---------------------------------------------------------------------------
// get_search_console_insights
// ---------------------------------------------------------------------------

const insightsInputSchema = {
  projectId: projectIdSchema,
  view: z
    .enum(["decay", "cannibalization"])
    .describe(
      "decay: pages or queries that lost clicks or impressions against the period right before the range. cannibalization: queries where two or more of your pages each get a real share of the impressions.",
    ),
  dimension: z
    .enum(["page", "query"])
    .optional()
    .describe("decay only: compare pages (default) or queries."),
  dateRange: z
    .enum(SEARCH_PERFORMANCE_RANGES)
    .optional()
    .describe(
      "The period to analyse (default last_28_days). decay compares it with the equally long period before it.",
    ),
  pageContains: pageContainsSchema,
} as const;

type InsightsArgs = z.infer<z.ZodObject<typeof insightsInputSchema>>;

export const getSearchConsoleInsightsTool = {
  name: "get_search_console_insights",
  config: {
    title: "Get Search Console insights",
    description:
      "Two derived Search Console views that a plain performance query cannot give. 'decay' lists pages (or queries) that had at least 50 impressions in the period before and have lost clicks or impressions since, biggest loss first by clicks, then impressions. 'cannibalization' lists queries where two or more of your pages each get at least 10% of the impressions and at least 10 impressions (URL fragments merged), with each page's position, clicks and impressions. Reads up to 25,000 rows per call, far beyond get_search_console_performance's 1,000. Read-only; uses no credits.",
    inputSchema: insightsInputSchema,
    outputSchema: z.looseObject({
      ok: z.boolean(),
      reason: z.string().optional(),
      connectionRequired: z.boolean().optional(),
      connectUrl: z.string().optional(),
      view: z.string().optional(),
      rows: z.array(looseObjectOutputSchema).optional(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: InsightsArgs, context) => {
    const blocked = await missingSelfHostedGoogleClientResponse(
      context,
      args.projectId,
    );
    if (blocked) return blocked;
    const range = resolveDateRange({ dateRange: args.dateRange });
    const filters = pageFilter(args.pageContains);
    const meta = buildProjectMeta(
      context,
      args.projectId,
      `/p/${args.projectId}/search-performance`,
      { tab: args.view },
    );
    try {
      if (args.view === "decay") {
        const result = await SearchInsightsService.getDecay({
          projectId: args.projectId,
          ...range,
          filters,
          dimension: args.dimension ?? "page",
        });
        const header = `${result.dimension} decay · ${result.current.startDate}→${result.current.endDate} vs ${result.previous.startDate}→${result.previous.endDate} · ${result.rows.length} row${result.rows.length === 1 ? "" : "s"}${result.mayBeIncomplete ? " · Google's 25,000-row cap was reached, so the quietest keys may be missing" : ""}`;
        return mcpResponse({
          text:
            result.rows.length > 0
              ? `${header}\n${formatMcpTable(
                  result.rows,
                  PAGE_DELTA_COLUMNS.map((column, index) =>
                    index === 0
                      ? { ...column, header: result.dimension }
                      : column,
                  ),
                )}`
              : `${header}\nNothing with at least 50 earlier impressions lost clicks or impressions.`,
          meta,
          structuredContent: { ok: true, view: "decay", ...result },
        });
      }
      const result = await SearchInsightsService.getCannibalization({
        projectId: args.projectId,
        ...range,
        filters,
      });
      const header = `cannibalization · ${result.current.startDate}→${result.current.endDate} · ${result.rows.length} quer${result.rows.length === 1 ? "y" : "ies"}${result.mayBeIncomplete ? " · Google's 25,000-row cap was reached, so some pairs may be missing" : ""}`;
      return mcpResponse({
        text:
          result.rows.length > 0
            ? `${header}\n${formatMcpTable(result.rows, [
                { header: "query", value: (row) => row.query },
                { header: "impressions", value: (row) => row.totalImpressions },
                { header: "clicks", value: (row) => row.totalClicks },
                {
                  header: "competing pages (position, impressions, clicks)",
                  value: (row) =>
                    row.pages
                      .map(
                        (page) =>
                          `${page.page} (${positionCell(page.position)}, ${page.impressions}, ${page.clicks})`,
                      )
                      .join("; "),
                },
              ])}`
            : `${header}\nNo query has two or more pages with a real share of its impressions.`,
        meta,
        structuredContent: { ok: true, view: "cannibalization", ...result },
      });
    } catch (error) {
      return gscFailure(context, args.projectId, error);
    }
  }),
};
