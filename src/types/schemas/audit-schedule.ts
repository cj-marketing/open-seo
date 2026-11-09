import { z } from "zod";
import { MIN_AUDIT_PAGES, PAID_MAX_AUDIT_PAGES } from "@/shared/audit-limits";

export const getAuditScheduleSchema = z.object({
  projectId: z.string().min(1),
});

/** Fields left out keep their stored value; a first save needs startUrl. */
export const saveAuditScheduleSchema = z.object({
  projectId: z.string().min(1),
  isActive: z.boolean().optional(),
  startUrl: z.string().trim().min(1).max(2048).optional(),
  maxPages: z
    .number()
    .int()
    .min(MIN_AUDIT_PAGES)
    .max(PAID_MAX_AUDIT_PAGES)
    .optional(),
  lighthouseStrategy: z.enum(["auto", "none"]).optional(),
  renderJavaScript: z.boolean().optional(),
});

export type SaveAuditScheduleInput = Omit<
  z.output<typeof saveAuditScheduleSchema>,
  "projectId"
>;
