import { AuditScheduleRepository } from "@/server/features/audit/repositories/AuditScheduleRepository";
import { AUDIT_LIMITS } from "@/server/features/audit/services/audit-capacity";
import { AuditService } from "@/server/features/audit/services/AuditService";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import {
  auditRenderingUnavailableMessage,
  isAuditRenderingAllowed,
} from "@/server/lib/audit/rendering-policy";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { AppError } from "@/server/lib/errors";
import { DEFAULT_AUDIT_PAGES } from "@/shared/audit-limits";
import { computeNextCheckAt } from "@/shared/rank-tracking";
import type { SaveAuditScheduleInput } from "@/types/schemas/audit-schedule";

async function getSchedule(projectId: string) {
  const row = await AuditScheduleRepository.getByProject(projectId);
  if (!row) return null;
  return {
    isActive: row.isActive,
    startUrl: row.startUrl,
    maxPages: row.maxPages,
    lighthouseStrategy: row.lighthouseStrategy,
    renderJavaScript: row.renderJavaScript,
    scheduleInterval: row.scheduleInterval,
    nextCheckAt: row.isActive ? row.nextCheckAt : null,
    lastStartedAt: row.lastStartedAt,
    lastSkipReason: row.lastSkipReason,
  };
}

/**
 * Creates or edits a project's monthly audit. A schedule starts switched off
 * and without Lighthouse (it is billed per page tested); the first run lands
 * on the next month end, so switching it on never starts an audit by itself.
 */
async function saveSchedule(
  customer: BillingCustomerContext,
  projectId: string,
  input: SaveAuditScheduleInput,
) {
  const existing = await AuditScheduleRepository.getByProject(projectId);
  const startUrlInput = input.startUrl ?? existing?.startUrl;
  if (!startUrlInput) {
    throw new AppError(
      "VALIDATION_ERROR",
      "A start URL is required to create the schedule.",
    );
  }
  const startUrl = await normalizeAndValidateStartUrl(startUrlInput);
  const maxPages = input.maxPages ?? existing?.maxPages ?? DEFAULT_AUDIT_PAGES;
  const renderJavaScript =
    input.renderJavaScript ?? existing?.renderJavaScript ?? false;
  const isActive = input.isActive ?? existing?.isActive ?? false;

  const limitTier = await AuditService.resolveAuditLimitTier(customer);
  if (maxPages > AUDIT_LIMITS[limitTier].maxPagesPerAudit) {
    throw new AppError("AUDIT_PAGE_LIMIT_EXCEEDED");
  }
  if (renderJavaScript && !(await isAuditRenderingAllowed())) {
    throw new AppError(
      "AUDIT_RENDERING_UNAVAILABLE",
      await auditRenderingUnavailableMessage(),
    );
  }

  // Keep the planned slot while the schedule stays on; switching on picks the
  // next month end, switching off clears it.
  const nextCheckAt = isActive
    ? existing?.isActive && existing.nextCheckAt
      ? existing.nextCheckAt
      : computeNextCheckAt("monthly")
    : null;

  await AuditScheduleRepository.upsert(projectId, customer.userId, {
    startUrl,
    maxPages,
    lighthouseStrategy:
      input.lighthouseStrategy ?? existing?.lighthouseStrategy ?? "none",
    renderJavaScript,
    isActive,
    nextCheckAt,
  });
  return getSchedule(projectId);
}

export const AuditScheduleService = {
  getSchedule,
  saveSchedule,
} as const;
