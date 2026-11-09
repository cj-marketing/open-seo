import { AuditScheduleRepository } from "@/server/features/audit/repositories/AuditScheduleRepository";
import { AuditService } from "@/server/features/audit/services/AuditService";
import { customerHasPaidPlan } from "@/server/billing/subscription";
import { AppError, describeError } from "@/server/lib/errors";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import type { ErrorCode } from "@/shared/error-codes";
import type { AuditScheduleSkipReason } from "@/shared/audit-schedule";
import { computeNextCheckAt } from "@/shared/rank-tracking";

// Wall-clock guard for the per-schedule loop. Stopping early is safe: schedules
// not reached stay due and the next tick resumes oldest-first.
const TICK_DEADLINE_MS = 2 * 60_000;

// Each start crawls a site for minutes, so a tick starts a handful at most.
const MAX_STARTS_PER_TICK = 20;

// Refusals that clear on their own: the slot is given back and the next tick
// tries again. Everything else keeps the schedule moved on to next month.
const RETRY_NEXT_TICK_CODES = new Set<ErrorCode>([
  "AUDIT_ALREADY_RUNNING",
  "AUDIT_CAPACITY_REACHED",
]);

function skipReasonFor(error: unknown): AuditScheduleSkipReason {
  if (!(error instanceof AppError)) return "start_failed";
  switch (error.code) {
    case "AUDIT_ALREADY_RUNNING":
      return "audit_running";
    case "AUDIT_CAPACITY_REACHED":
      return "capacity_reached";
    case "INSUFFICIENT_CREDITS":
      return "insufficient_credits";
    case "AUDIT_PAGE_LIMIT_EXCEEDED":
      return "page_limit_exceeded";
    case "AUDIT_RENDERING_UNAVAILABLE":
      return "rendering_unavailable";
    case "CRAWL_TARGET_BLOCKED":
    case "VALIDATION_ERROR":
      return "start_url_blocked";
    default:
      return "start_failed";
  }
}

// Cron body for the `scheduled` Worker handler: start the monthly audit of
// every project whose schedule is due. Wrapped in `withPgClient` at the
// entrypoint (server.ts).
export async function runScheduledAudits() {
  const dueSchedules = await AuditScheduleRepository.getDueWithOrganization(
    new Date().toISOString(),
  );
  if (dueSchedules.length === 0) return;
  const isHosted = await isHostedServerAuthMode();

  // Function-local so it lives exactly one tick (see scheduledRankChecks.ts).
  const paidPlanChecks = new Map<string, Promise<boolean>>();
  const checkPaidPlan = (organizationId: string) => {
    let check = paidPlanChecks.get(organizationId);
    if (!check) {
      check = customerHasPaidPlan(organizationId, { retryDenied: true });
      paidPlanChecks.set(organizationId, check);
    }
    return check;
  };

  const deadline = Date.now() + TICK_DEADLINE_MS;
  let started = 0;
  let skipped = 0;
  let errors = 0;

  for (const schedule of dueSchedules) {
    if (Date.now() >= deadline || started >= MAX_STARTS_PER_TICK) break;
    // Unreachable: the due query excludes NULL next check times.
    if (!schedule.nextCheckAt) continue;
    const observedNextCheckAt = schedule.nextCheckAt;
    const nextCheckAt = computeNextCheckAt("monthly", observedNextCheckAt);

    try {
      // Audits are not unique per project, so check before claiming. The slot
      // stays put, the reason shows in the UI, and the next tick tries again.
      if (await AuditScheduleRepository.hasRunningAudit(schedule.projectId)) {
        await AuditScheduleRepository.claimDue({
          scheduleId: schedule.id,
          observedNextCheckAt,
          nextCheckAt: observedNextCheckAt,
          lastSkipReason: "audit_running",
        });
        skipped++;
        continue;
      }

      // Self-hosted deployments treat every schedule as paid.
      if (isHosted) {
        let hasPaidPlan: boolean;
        try {
          hasPaidPlan = await checkPaidPlan(schedule.organizationId);
        } catch (error) {
          // Never write next_check_at on an error: it is the schedule anchor.
          // Leaving the row due is the retry.
          console.error(
            `[cron] Plan check failed for audit schedule ${schedule.id}: ${describeError(error)}`,
          );
          errors++;
          continue;
        }
        if (!hasPaidPlan) {
          await AuditScheduleRepository.claimDue({
            scheduleId: schedule.id,
            observedNextCheckAt,
            nextCheckAt,
            lastSkipReason: "plan_required",
          });
          skipped++;
          continue;
        }
      }

      // Claim the slot before starting, so a second tick or isolate cannot
      // start the same audit.
      const claimed = await AuditScheduleRepository.claimDue({
        scheduleId: schedule.id,
        observedNextCheckAt,
        nextCheckAt,
        lastSkipReason: null,
      });
      if (!claimed) continue;

      try {
        await AuditService.startAudit({
          actorUserId: "system",
          billingCustomer: {
            userId: "system",
            userEmail: "system@openseo.so",
            organizationId: schedule.organizationId,
            projectId: schedule.projectId,
          },
          projectId: schedule.projectId,
          startUrl: schedule.startUrl,
          maxPages: schedule.maxPages,
          lighthouseStrategy: schedule.lighthouseStrategy,
          renderJavaScript: schedule.renderJavaScript,
          limitTier: isHosted ? "paid" : "self_hosted",
        });
        started++;
        await AuditScheduleRepository.claimDue({
          scheduleId: schedule.id,
          observedNextCheckAt: nextCheckAt,
          nextCheckAt,
          lastStartedAt: new Date().toISOString(),
        });
      } catch (error) {
        skipped++;
        const reason = skipReasonFor(error);
        if (reason === "start_failed") {
          errors++;
          console.error(
            `[cron] Failed to start scheduled audit ${schedule.id}: ${describeError(error)}`,
            error,
          );
        }
        // A manual edit landing in between wins the compare-and-set.
        const retry =
          error instanceof AppError && RETRY_NEXT_TICK_CODES.has(error.code);
        await AuditScheduleRepository.claimDue({
          scheduleId: schedule.id,
          observedNextCheckAt: nextCheckAt,
          nextCheckAt: retry ? observedNextCheckAt : nextCheckAt,
          lastSkipReason: reason,
        });
      }
    } catch (error) {
      errors++;
      console.error(
        `[cron] Error processing audit schedule ${schedule.id}: ${describeError(error)}`,
        error,
      );
    }
  }

  (errors > 0 ? console.error : console.log)({
    event: "audit_schedule_summary",
    candidates: dueSchedules.length,
    started,
    skipped,
    errors,
  });
}
