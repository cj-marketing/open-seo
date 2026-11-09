import { z } from "zod";
import { AuditCompareService } from "@/server/features/audit/services/AuditCompareService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable } from "@/server/mcp/table";
import { getIssueDescriptor } from "@/shared/audit-issues";
import {
  COMPARE_DEFAULT_PAGE_SIZE,
  COMPARE_ISSUE_CLASSES,
  COMPARE_MAX_PAGE_SIZE,
} from "@/types/schemas/audit-compare";

const LIST_VALUES = [
  ...COMPARE_ISSUE_CLASSES,
  "pagesAdded",
  "pagesRemoved",
  "pagesChanged",
] as const;

const inputSchema = {
  projectId: projectIdSchema,
  baseAuditId: z
    .string()
    .min(1)
    .describe("The earlier audit (the baseline), from list_site_audits."),
  targetAuditId: z
    .string()
    .min(1)
    .describe("The later audit to compare against the baseline."),
  list: z
    .enum(LIST_VALUES)
    .optional()
    .describe(
      "Also return one paged list: new, fixed, onNewPage, onRemovedPage (issues), or pagesAdded, pagesRemoved, pagesChanged (pages). Omit for the summary only.",
    ),
  issueType: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe("Restrict an issue list to one issue type."),
  page: z.number().int().positive().optional().describe("List page, from 1."),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(COMPARE_MAX_PAGE_SIZE)
    .optional()
    .describe(`List page size (default ${COMPARE_DEFAULT_PAGE_SIZE}).`),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

function issueLabel(issueType: string) {
  return getIssueDescriptor(issueType)?.title ?? issueType;
}

async function loadList(args: Args) {
  const paging = {
    page: args.page ?? 1,
    pageSize: args.pageSize ?? COMPARE_DEFAULT_PAGE_SIZE,
  };
  const pair = {
    baseAuditId: args.baseAuditId,
    targetAuditId: args.targetAuditId,
  };
  const list = args.list;
  if (!list) return null;
  if (
    list === "pagesAdded" ||
    list === "pagesRemoved" ||
    list === "pagesChanged"
  ) {
    const kind =
      list === "pagesAdded"
        ? "added"
        : list === "pagesRemoved"
          ? "removed"
          : "changed";
    return {
      name: list,
      ...paging,
      ...(await AuditCompareService.listPages(args.projectId, {
        ...pair,
        ...paging,
        kind,
      })),
    };
  }
  return {
    name: list,
    ...paging,
    ...(await AuditCompareService.listIssues(args.projectId, {
      ...pair,
      ...paging,
      issueClass: list,
      issueType: args.issueType,
    })),
  };
}

export const compareSiteAuditsTool = {
  name: "compare_site_audits",
  config: {
    title: "Compare site audits",
    description:
      "Compares two completed audits of one project: which issues are new, which are fixed, pages added and removed, pages whose status code or title changed, and Lighthouse score changes. Audits can crawl different pages, so new and fixed only count pages crawled in both; issues on pages only one audit crawled are reported separately as onNewPage and onRemovedPage, and coverageWarning is set when the page counts differ by more than 20%. Returns a summary, plus one paged list when `list` is set. Uses no credits.",
    inputSchema,
    outputSchema: z.looseObject({
      comparison: looseObjectOutputSchema,
      list: looseObjectOutputSchema.nullable().optional(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const comparison = await AuditCompareService.compare(
      args.projectId,
      args.baseAuditId,
      args.targetAuditId,
    );
    const list = await loadList(args);
    const { totals, pages } = comparison;
    const lines = [
      `Base ${comparison.base.id} (${comparison.base.pageCount} pages) vs target ${comparison.target.id} (${comparison.target.pageCount} pages).`,
      ...(comparison.coverageWarning ? [comparison.coverageWarning] : []),
      `Issues: ${totals.new} new, ${totals.fixed} fixed, ${totals.onNewPage} on new pages, ${totals.onRemovedPage} on removed pages.`,
      `Pages: ${pages.added} added, ${pages.removed} removed, ${pages.changed} with a changed status code or title.`,
      formatMcpTable(
        comparison.issueTypes.filter(
          (row) => row.new + row.fixed + row.onNewPage + row.onRemovedPage > 0,
        ),
        [
          { header: "Issue", value: (row) => issueLabel(row.issueType) },
          { header: "Severity", value: (row) => row.severity },
          { header: "Base", value: (row) => row.base },
          { header: "Target", value: (row) => row.target },
          { header: "New", value: (row) => row.new },
          { header: "Fixed", value: (row) => row.fixed },
          { header: "On new pages", value: (row) => row.onNewPage },
          { header: "On removed pages", value: (row) => row.onRemovedPage },
        ],
      ),
    ];
    if (list) {
      lines.push(
        `List ${list.name}: ${list.rows.length} of ${list.totalCount} (page ${list.page}).`,
        JSON.stringify(list.rows),
      );
    }
    return mcpResponse({
      text: lines.join("\n"),
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/audit?auditId=${args.targetAuditId}&compareTo=${args.baseAuditId}`,
      ),
      structuredContent: { comparison, list },
    });
  }),
};
