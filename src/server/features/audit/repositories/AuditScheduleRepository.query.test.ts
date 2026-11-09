import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as AuditScheduleRepositoryModule from "./AuditScheduleRepository";

// Real in-memory SQLite so the due query and the compare-and-set claim run
// against actual SQL.

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

let client: Client;
let AuditScheduleRepository: typeof AuditScheduleRepositoryModule.AuditScheduleRepository;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  vi.doMock("@/db", () => ({ db: drizzle(client) }));
  await client.executeMultiple(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE audits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE audit_schedules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      start_url TEXT NOT NULL,
      max_pages INTEGER NOT NULL,
      lighthouse_strategy TEXT NOT NULL DEFAULT 'none',
      render_javascript INTEGER NOT NULL DEFAULT 0,
      schedule_interval TEXT NOT NULL DEFAULT 'monthly',
      is_active INTEGER NOT NULL DEFAULT 0,
      next_check_at TEXT,
      last_started_at TEXT,
      last_skip_reason TEXT,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX audit_schedules_project_id_idx
      ON audit_schedules (project_id);
  `);
  ({ AuditScheduleRepository } = await import("./AuditScheduleRepository"));
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM audit_schedules;
    DELETE FROM audits;
    DELETE FROM projects;
  `);
});

const NOW = "2026-02-01T00:00:00.000Z";
const PAST = "2026-01-31T05:00:00.000Z";

async function seed(
  projectId: string,
  options: {
    isActive?: boolean;
    nextCheckAt?: string;
    archived?: boolean;
  } = {},
) {
  await client.execute({
    sql: "INSERT INTO projects (id, organization_id, name, archived_at) VALUES (?, 'org_1', ?, ?)",
    args: [projectId, projectId, options.archived ? NOW : null],
  });
  await AuditScheduleRepository.upsert(projectId, "user_1", {
    startUrl: "https://example.com",
    maxPages: 50,
    lighthouseStrategy: "none",
    renderJavaScript: false,
    isActive: options.isActive ?? true,
    nextCheckAt: options.nextCheckAt ?? PAST,
  });
}

describe("AuditScheduleRepository", () => {
  it("returns only active, due schedules of projects that are not archived", async () => {
    await seed("due");
    await seed("off", { isActive: false });
    await seed("later", { nextCheckAt: "2026-03-01T00:00:00.000Z" });
    await seed("archived", { archived: true });

    const due = await AuditScheduleRepository.getDueWithOrganization(NOW);

    expect(due.map((row) => row.projectId)).toEqual(["due"]);
    expect(due[0].organizationId).toBe("org_1");
  });

  it("lets exactly one of two ticks claim the same slot", async () => {
    await seed("project_1");
    const [schedule] =
      await AuditScheduleRepository.getDueWithOrganization(NOW);
    const claim = {
      scheduleId: schedule.id,
      observedNextCheckAt: PAST,
      nextCheckAt: "2026-02-28T05:00:00.000Z",
    };

    const first = await AuditScheduleRepository.claimDue(claim);
    const second = await AuditScheduleRepository.claimDue(claim);

    expect([first, second]).toEqual([true, false]);
    expect(await AuditScheduleRepository.getDueWithOrganization(NOW)).toEqual(
      [],
    );
  });

  it("does not claim a schedule the user switched off in the meantime", async () => {
    await seed("project_1");
    const [schedule] =
      await AuditScheduleRepository.getDueWithOrganization(NOW);
    await client.execute("UPDATE audit_schedules SET is_active = 0");

    const claimed = await AuditScheduleRepository.claimDue({
      scheduleId: schedule.id,
      observedNextCheckAt: PAST,
      nextCheckAt: "2026-02-28T05:00:00.000Z",
    });

    expect(claimed).toBe(false);
  });

  it("sees a running audit of the project only", async () => {
    await client.execute(
      "INSERT INTO audits (id, project_id, status) VALUES ('a1', 'project_1', 'running'), ('a2', 'project_2', 'completed')",
    );

    expect(await AuditScheduleRepository.hasRunningAudit("project_1")).toBe(
      true,
    );
    expect(await AuditScheduleRepository.hasRunningAudit("project_2")).toBe(
      false,
    );
  });
});
