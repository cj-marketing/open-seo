import { createServerFn } from "@tanstack/react-start";
import { AuditCompareService } from "@/server/features/audit/services/AuditCompareService";
import { AuditScheduleService } from "@/server/features/audit/services/AuditScheduleService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  compareAuditsSchema,
  compareIssuesSchema,
  comparePagesSchema,
} from "@/types/schemas/audit-compare";
import {
  getAuditScheduleSchema,
  saveAuditScheduleSchema,
} from "@/types/schemas/audit-schedule";

export const compareAudits = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(compareAuditsSchema)
  .handler(async ({ data, context }) =>
    AuditCompareService.compare(
      context.projectId,
      data.baseAuditId,
      data.targetAuditId,
    ),
  );

export const getAuditCompareIssues = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(compareIssuesSchema)
  .handler(async ({ data, context }) => {
    const { projectId: _projectId, ...input } = data;
    return AuditCompareService.listIssues(context.projectId, input);
  });

export const getAuditComparePages = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(comparePagesSchema)
  .handler(async ({ data, context }) => {
    const { projectId: _projectId, ...input } = data;
    return AuditCompareService.listPages(context.projectId, input);
  });

export const getAuditSchedule = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getAuditScheduleSchema)
  .handler(async ({ context }) =>
    AuditScheduleService.getSchedule(context.projectId),
  );

export const saveAuditSchedule = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(saveAuditScheduleSchema)
  .handler(async ({ data, context }) => {
    const { projectId: _projectId, ...input } = data;
    return AuditScheduleService.saveSchedule(context, context.projectId, input);
  });
