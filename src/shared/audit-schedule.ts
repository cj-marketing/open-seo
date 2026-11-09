/**
 * Values written to audit_schedules.last_skip_reason (free-form text in the
 * schema; this union keeps the cron writer and the UI in sync).
 */
export type AuditScheduleSkipReason =
  | "plan_required"
  | "audit_running"
  | "capacity_reached"
  | "insufficient_credits"
  | "page_limit_exceeded"
  | "rendering_unavailable"
  | "start_url_blocked"
  | "start_failed";

const SKIP_REASON_MESSAGES: Record<AuditScheduleSkipReason, string> = {
  plan_required: "Scheduled audits need a paid plan.",
  audit_running:
    "An audit was already running for this project. The scheduled audit starts as soon as it finishes.",
  capacity_reached:
    "Audit capacity was reached. The scheduled audit retries automatically.",
  insufficient_credits:
    "Not enough credits to hold the cost of rendering JavaScript.",
  page_limit_exceeded: "The page limit exceeds what the plan allows.",
  rendering_unavailable: "JavaScript rendering is not available.",
  start_url_blocked: "The start URL cannot be crawled.",
  start_failed: "The scheduled audit could not start.",
};

/** Human text for a stored skip reason; unknown values read as a failed start. */
export function describeAuditScheduleSkipReason(
  reason: string | null,
): string | null {
  if (!reason) return null;
  const known = Object.entries(SKIP_REASON_MESSAGES).find(
    ([key]) => key === reason,
  );
  return known ? known[1] : SKIP_REASON_MESSAGES.start_failed;
}
