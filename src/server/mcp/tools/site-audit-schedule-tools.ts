import { z } from "zod";
import { AuditScheduleService } from "@/server/features/audit/services/AuditScheduleService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { describeAuditScheduleSkipReason } from "@/shared/audit-schedule";

const inputSchema = {
  projectId: projectIdSchema,
  isActive: z
    .boolean()
    .optional()
    .describe(
      "Turn the monthly audit on or off. A schedule is off until a user turns it on; confirm with the user first.",
    ),
  startUrl: z
    .string()
    .min(1)
    .max(2048)
    .optional()
    .describe("Start URL to crawl. Required when creating the schedule."),
  maxPages: z
    .number()
    .int()
    .min(10)
    .max(10_000)
    .optional()
    .describe("Page budget per audit (default 50), within the plan limit."),
  runLighthouse: z
    .boolean()
    .optional()
    .describe(
      "Run Lighthouse on a sample of pages in every scheduled audit (default false). It is billed to the operator's DataForSEO account, up to 10 URLs on mobile and desktop each month, so enable it only when the user asks.",
    ),
  renderJavaScript: z
    .boolean()
    .optional()
    .describe(
      "Render JavaScript before auditing (default false). On hosted plans this holds usage credits for each audit.",
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const setSiteAuditScheduleTool = {
  name: "set_site_audit_schedule",
  config: {
    title: "Set site audit schedule",
    description:
      "Creates or changes the project's monthly site audit (one per project). It runs at month end, off by default and without Lighthouse. Fields left out keep their stored value. Turning it on starts nothing now; use run_site_audit for an audit today. Use compare_site_audits to compare scheduled audits. Uses no credits itself.",
    inputSchema,
    outputSchema: z.looseObject({
      schedule: looseObjectOutputSchema.nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const schedule = await AuditScheduleService.saveSchedule(
      context.billing,
      args.projectId,
      {
        isActive: args.isActive,
        startUrl: args.startUrl,
        maxPages: args.maxPages,
        lighthouseStrategy:
          args.runLighthouse === undefined
            ? undefined
            : args.runLighthouse
              ? "auto"
              : "none",
        renderJavaScript: args.renderJavaScript,
      },
    );
    const text = schedule
      ? `Monthly audit of ${schedule.startUrl} is ${schedule.isActive ? `on; next run ${schedule.nextCheckAt}` : "off"} (${schedule.maxPages} pages, Lighthouse ${schedule.lighthouseStrategy === "auto" ? "on" : "off"}).`
      : "No schedule saved.";
    const skip = describeAuditScheduleSkipReason(
      schedule?.lastSkipReason ?? null,
    );
    return mcpResponse({
      text: skip ? `${text} Last run skipped: ${skip}` : text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/audit`,
      ),
      structuredContent: { schedule },
    });
  }),
};
