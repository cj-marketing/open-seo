import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditSchedules, audits, projects } from "@/db/schema";

type ScheduleValues = {
  startUrl: string;
  maxPages: number;
  lighthouseStrategy: "auto" | "none";
  renderJavaScript: boolean;
  isActive: boolean;
  nextCheckAt: string | null;
};

// A project's schedule is one row, so a tick never has many due.
const DUE_SCHEDULES_PER_TICK = 100;

async function getByProject(projectId: string) {
  const rows = await db
    .select()
    .from(auditSchedules)
    .where(eq(auditSchedules.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsert(
  projectId: string,
  createdByUserId: string,
  values: ScheduleValues,
) {
  const updatedAt = new Date().toISOString();
  await db
    .insert(auditSchedules)
    .values({
      id: crypto.randomUUID(),
      projectId,
      createdByUserId,
      ...values,
      lastSkipReason: null,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: auditSchedules.projectId,
      set: { ...values, lastSkipReason: null, updatedAt },
    });
}

async function getDueWithOrganization(nowIso: string) {
  return db
    .select({
      id: auditSchedules.id,
      projectId: auditSchedules.projectId,
      startUrl: auditSchedules.startUrl,
      maxPages: auditSchedules.maxPages,
      lighthouseStrategy: auditSchedules.lighthouseStrategy,
      renderJavaScript: auditSchedules.renderJavaScript,
      nextCheckAt: auditSchedules.nextCheckAt,
      organizationId: projects.organizationId,
    })
    .from(auditSchedules)
    .innerJoin(projects, eq(auditSchedules.projectId, projects.id))
    .where(
      and(
        eq(auditSchedules.isActive, true),
        lte(auditSchedules.nextCheckAt, nowIso),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(auditSchedules.nextCheckAt), asc(auditSchedules.id))
    .limit(DUE_SCHEDULES_PER_TICK);
}

/**
 * Conditionally moves a due schedule's next check, returning false when the
 * row changed since it was read (another tick claimed it, or the user edited
 * or switched it off). The caller starts the audit only when this wins.
 * `lastSkipReason` and `lastStartedAt` are written only when passed.
 */
async function claimDue(input: {
  scheduleId: string;
  observedNextCheckAt: string;
  nextCheckAt: string;
  lastSkipReason?: string | null;
  lastStartedAt?: string;
}): Promise<boolean> {
  const claimed = await db
    .update(auditSchedules)
    .set({
      nextCheckAt: input.nextCheckAt,
      ...(input.lastSkipReason !== undefined && {
        lastSkipReason: input.lastSkipReason,
      }),
      ...(input.lastStartedAt !== undefined && {
        lastStartedAt: input.lastStartedAt,
      }),
    })
    .where(
      and(
        eq(auditSchedules.id, input.scheduleId),
        eq(auditSchedules.isActive, true),
        eq(auditSchedules.nextCheckAt, input.observedNextCheckAt),
      ),
    )
    .returning({ id: auditSchedules.id });
  return claimed.length > 0;
}

async function hasRunningAudit(projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: audits.id })
    .from(audits)
    .where(and(eq(audits.projectId, projectId), eq(audits.status, "running")))
    .limit(1);
  return rows.length > 0;
}

export const AuditScheduleRepository = {
  getByProject,
  upsert,
  getDueWithOrganization,
  claimDue,
  hasRunningAudit,
} as const;
