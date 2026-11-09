import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/lib/errors";
import { runScheduledAudits } from "./scheduledAudits";

type DueSchedule = {
  id: string;
  projectId: string;
  startUrl: string;
  maxPages: number;
  lighthouseStrategy: "auto" | "none";
  renderJavaScript: boolean;
  nextCheckAt: string | null;
  organizationId: string;
};

type ClaimInput = {
  scheduleId: string;
  observedNextCheckAt: string;
  nextCheckAt: string;
  lastSkipReason?: string | null;
};

const mocks = vi.hoisted(() => ({
  getDueWithOrganization: vi.fn<() => Promise<DueSchedule[]>>(),
  claimDue: vi.fn<(input: ClaimInput) => Promise<boolean>>(),
  hasRunningAudit: vi.fn<(projectId: string) => Promise<boolean>>(),
  startAudit: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  customerHasPaidPlan: vi.fn<(organizationId: string) => Promise<boolean>>(),
  isHostedServerAuthMode: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/audit/repositories/AuditScheduleRepository", () => ({
  AuditScheduleRepository: {
    getDueWithOrganization: mocks.getDueWithOrganization,
    claimDue: mocks.claimDue,
    hasRunningAudit: mocks.hasRunningAudit,
  },
}));
vi.mock("@/server/features/audit/services/AuditService", () => ({
  AuditService: { startAudit: mocks.startAudit },
}));
vi.mock("@/server/billing/subscription", () => ({
  customerHasPaidPlan: mocks.customerHasPaidPlan,
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
}));

const DUE = "2026-01-31T05:00:00.000Z";

function schedule(overrides: Partial<DueSchedule> = {}): DueSchedule {
  return {
    id: "schedule_1",
    projectId: "project_1",
    startUrl: "https://example.com",
    maxPages: 50,
    lighthouseStrategy: "none",
    renderJavaScript: false,
    nextCheckAt: DUE,
    organizationId: "org_1",
    ...overrides,
  };
}

describe("runScheduledAudits", () => {
  beforeEach(() => {
    mocks.isHostedServerAuthMode.mockResolvedValue(true);
    mocks.customerHasPaidPlan.mockResolvedValue(true);
    mocks.hasRunningAudit.mockResolvedValue(false);
    mocks.claimDue.mockResolvedValue(true);
    mocks.startAudit.mockResolvedValue({ auditId: "audit_1" });
    mocks.getDueWithOrganization.mockResolvedValue([schedule()]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("claims the slot a month ahead, then starts the audit as the system user without Lighthouse", async () => {
    await runScheduledAudits();

    const [claim] = mocks.claimDue.mock.calls[0];
    expect(claim).toMatchObject({
      scheduleId: "schedule_1",
      observedNextCheckAt: DUE,
      lastSkipReason: null,
    });
    expect(new Date(claim.nextCheckAt).getTime()).toBeGreaterThan(Date.now());
    expect(mocks.startAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "system",
        projectId: "project_1",
        lighthouseStrategy: "none",
        limitTier: "paid",
      }),
    );
  });

  it("does not start an audit when another tick already claimed the slot", async () => {
    mocks.claimDue.mockResolvedValue(false);

    await runScheduledAudits();

    expect(mocks.startAudit).not.toHaveBeenCalled();
  });

  it("keeps the slot and records audit_running while an audit is running", async () => {
    mocks.hasRunningAudit.mockResolvedValue(true);

    await runScheduledAudits();

    expect(mocks.claimDue).toHaveBeenCalledTimes(1);
    expect(mocks.claimDue).toHaveBeenCalledWith({
      scheduleId: "schedule_1",
      observedNextCheckAt: DUE,
      nextCheckAt: DUE,
      lastSkipReason: "audit_running",
    });
    expect(mocks.startAudit).not.toHaveBeenCalled();
  });

  it("moves a free hosted project on with plan_required instead of starting", async () => {
    mocks.customerHasPaidPlan.mockResolvedValue(false);

    await runScheduledAudits();

    expect(mocks.claimDue).toHaveBeenCalledWith(
      expect.objectContaining({ lastSkipReason: "plan_required" }),
    );
    expect(mocks.startAudit).not.toHaveBeenCalled();
  });

  it("gives the slot back when the account is at its audit capacity", async () => {
    mocks.startAudit.mockRejectedValue(new AppError("AUDIT_CAPACITY_REACHED"));

    await runScheduledAudits();

    const [claim, restore] = mocks.claimDue.mock.calls.map(([input]) => input);
    expect(restore).toMatchObject({
      observedNextCheckAt: claim.nextCheckAt,
      nextCheckAt: DUE,
      lastSkipReason: "capacity_reached",
    });
  });

  it("keeps the next month and records why when credits cannot cover the render hold", async () => {
    mocks.startAudit.mockRejectedValue(new AppError("INSUFFICIENT_CREDITS"));

    await runScheduledAudits();

    const [claim, skip] = mocks.claimDue.mock.calls.map(([input]) => input);
    expect(skip).toMatchObject({
      nextCheckAt: claim.nextCheckAt,
      lastSkipReason: "insufficient_credits",
    });
  });

  it("makes no plan check and starts as self_hosted outside hosted mode", async () => {
    mocks.isHostedServerAuthMode.mockResolvedValue(false);

    await runScheduledAudits();

    expect(mocks.customerHasPaidPlan).not.toHaveBeenCalled();
    expect(mocks.startAudit).toHaveBeenCalledWith(
      expect.objectContaining({ limitTier: "self_hosted" }),
    );
  });
});
