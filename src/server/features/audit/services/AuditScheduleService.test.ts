import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditScheduleService } from "./AuditScheduleService";

type Stored = {
  startUrl: string;
  maxPages: number;
  lighthouseStrategy: "auto" | "none";
  renderJavaScript: boolean;
  isActive: boolean;
  nextCheckAt: string | null;
};

const mocks = vi.hoisted(() => ({
  getByProject: vi.fn<(projectId: string) => Promise<unknown>>(),
  upsert: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/audit/repositories/AuditScheduleRepository", () => ({
  AuditScheduleRepository: {
    getByProject: mocks.getByProject,
    upsert: mocks.upsert,
  },
}));
vi.mock("@/server/features/audit/services/AuditService", () => ({
  AuditService: { resolveAuditLimitTier: () => Promise.resolve("self_hosted") },
}));
vi.mock("@/server/lib/audit/url-policy", () => ({
  normalizeAndValidateStartUrl: (url: string) => Promise.resolve(url),
}));
vi.mock("@/server/lib/audit/rendering-policy", () => ({
  isAuditRenderingAllowed: () => Promise.resolve(false),
  auditRenderingUnavailableMessage: () => Promise.resolve("no renderer"),
}));

const customer = {
  userId: "user_1",
  userEmail: "u@example.com",
  organizationId: "org_1",
};

function savedValues(): Stored {
  const call = mocks.upsert.mock.calls.at(-1);
  if (!call) throw new Error("upsert was not called");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test reads the repository's last write
  return call[2] as Stored;
}

describe("AuditScheduleService.saveSchedule", () => {
  beforeEach(() => {
    mocks.getByProject.mockResolvedValue(null);
    mocks.upsert.mockResolvedValue();
  });

  it("creates a schedule that is off, without Lighthouse, and with no run planned", async () => {
    await AuditScheduleService.saveSchedule(customer, "project_1", {
      startUrl: "https://example.com",
    });

    expect(savedValues()).toMatchObject({
      isActive: false,
      lighthouseStrategy: "none",
      renderJavaScript: false,
      nextCheckAt: null,
    });
  });

  it("plans the first run at a future month end when switched on", async () => {
    await AuditScheduleService.saveSchedule(customer, "project_1", {
      startUrl: "https://example.com",
      isActive: true,
    });

    const { nextCheckAt } = savedValues();
    expect(new Date(nextCheckAt ?? "").getTime()).toBeGreaterThan(Date.now());
  });

  it("keeps the planned slot when an active schedule is edited", async () => {
    const planned = "2099-01-31T05:00:00.000Z";
    mocks.getByProject.mockResolvedValue({
      startUrl: "https://example.com",
      maxPages: 50,
      lighthouseStrategy: "none",
      renderJavaScript: false,
      isActive: true,
      nextCheckAt: planned,
    });

    await AuditScheduleService.saveSchedule(customer, "project_1", {
      maxPages: 100,
    });

    expect(savedValues()).toMatchObject({
      maxPages: 100,
      nextCheckAt: planned,
    });
  });

  it("needs a start URL for a first save", async () => {
    await expect(
      AuditScheduleService.saveSchedule(customer, "project_1", {}),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
