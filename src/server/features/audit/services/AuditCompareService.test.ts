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
import type * as AuditCompareServiceModule from "./AuditCompareService";

// Real in-memory SQLite: the compare classification is SQL, so mocked rows
// would not exercise it.

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

const audit = (id: string, status = "completed") => ({
  id,
  status,
  startUrl: "https://example.com",
  startedAt: "2026-01-01",
  completedAt: "2026-01-01",
});

const mocks = vi.hoisted(() => ({
  getAuditForProject: vi.fn<(id: string) => Promise<unknown>>(),
}));

vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: { getAuditForProject: mocks.getAuditForProject },
}));

let client: Client;
let AuditCompareService: typeof AuditCompareServiceModule.AuditCompareService;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  vi.doMock("@/db", () => ({ db: drizzle(client) }));
  await client.executeMultiple(`
    CREATE TABLE audit_pages (
      id TEXT PRIMARY KEY,
      audit_id TEXT NOT NULL,
      url TEXT NOT NULL,
      status_code INTEGER,
      title TEXT,
      fetch_class TEXT NOT NULL DEFAULT 'ok'
    );
    CREATE TABLE audit_issues (
      id TEXT PRIMARY KEY,
      audit_id TEXT NOT NULL,
      page_id TEXT,
      page_url TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      details_json TEXT
    );
    CREATE TABLE audit_lighthouse_results (
      id TEXT PRIMARY KEY,
      audit_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      strategy TEXT NOT NULL,
      performance_score INTEGER,
      accessibility_score INTEGER,
      best_practices_score INTEGER,
      seo_score INTEGER
    );
  `);
  ({ AuditCompareService } = await import("./AuditCompareService"));
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  mocks.getAuditForProject.mockImplementation((id) =>
    Promise.resolve(audit(id)),
  );
  await client.executeMultiple(`
    DELETE FROM audit_lighthouse_results;
    DELETE FROM audit_issues;
    DELETE FROM audit_pages;
  `);
});

let rowId = 0;
async function page(
  auditId: string,
  url: string,
  extra: { status?: number; title?: string; fetchClass?: string } = {},
) {
  rowId += 1;
  await client.execute({
    sql: "INSERT INTO audit_pages (id, audit_id, url, status_code, title, fetch_class) VALUES (?, ?, ?, ?, ?, ?)",
    args: [
      `page_${rowId}`,
      auditId,
      url,
      extra.status ?? 200,
      extra.title ?? "Title",
      extra.fetchClass ?? "ok",
    ],
  });
  return `page_${rowId}`;
}

async function issue(
  auditId: string,
  pageUrl: string,
  issueType: string,
  targetUrl?: string,
) {
  rowId += 1;
  await client.execute({
    sql: "INSERT INTO audit_issues (id, audit_id, page_url, issue_type, severity, details_json) VALUES (?, ?, ?, ?, 'warning', ?)",
    args: [
      `issue_${rowId}`,
      auditId,
      pageUrl,
      issueType,
      targetUrl ? JSON.stringify({ targetUrl }) : null,
    ],
  });
}

describe("AuditCompareService", () => {
  it("keeps crawl-coverage differences out of new and fixed", async () => {
    // Base crawled A, B, C. Target crawled A, B, D: C was dropped, D is new.
    for (const url of ["/a", "/b", "/c"]) await page("base", url);
    for (const url of ["/a", "/b", "/d"]) await page("target", url);

    await issue("base", "/a", "missing-title"); // still there: persists
    await issue("base", "/b", "missing-title"); // gone on a crawled page: fixed
    await issue("base", "/c", "missing-title"); // C was not crawled: removed page
    await issue("target", "/a", "missing-title");
    await issue("target", "/b", "thin-content"); // appeared on a crawled page: new
    await issue("target", "/d", "missing-title"); // D was not crawled: new page

    const result = await AuditCompareService.compare(
      "project_1",
      "base",
      "target",
    );

    expect(result.totals).toEqual({
      new: 1,
      fixed: 1,
      onNewPage: 1,
      onRemovedPage: 1,
    });
    const missingTitle = result.issueTypes.find(
      (row) => row.issueType === "missing-title",
    );
    expect(missingTitle).toMatchObject({
      base: 3,
      target: 2,
      new: 0,
      fixed: 1,
      onNewPage: 1,
      onRemovedPage: 1,
    });
    expect(result.pages).toMatchObject({ added: 1, removed: 1 });

    const fixed = await AuditCompareService.listIssues("project_1", {
      baseAuditId: "base",
      targetAuditId: "target",
      issueClass: "fixed",
      page: 1,
      pageSize: 10,
    });
    expect(fixed.rows.map((row) => row.pageUrl)).toEqual(["/b"]);
  });

  it("matches a broken link by its target, not just its page", async () => {
    await page("base", "/a");
    await page("target", "/a");
    await issue("base", "/a", "broken-internal-link", "/gone");
    await issue("base", "/a", "broken-internal-link", "/still-gone");
    await issue("target", "/a", "broken-internal-link", "/still-gone");
    await issue("target", "/a", "broken-internal-link", "/newly-gone");

    const result = await AuditCompareService.compare(
      "project_1",
      "base",
      "target",
    );

    expect(result.totals).toMatchObject({ new: 1, fixed: 1 });
    const added = await AuditCompareService.listIssues("project_1", {
      baseAuditId: "base",
      targetAuditId: "target",
      issueClass: "new",
      page: 1,
      pageSize: 10,
    });
    expect(added.rows.map((row) => row.linkTarget)).toEqual(["/newly-gone"]);
  });

  it("does not call an issue fixed on a page the later audit could not fetch", async () => {
    await page("base", "/a");
    await page("target", "/a", { status: 403, fetchClass: "blocked" });
    await issue("base", "/a", "missing-title");

    const result = await AuditCompareService.compare(
      "project_1",
      "base",
      "target",
    );

    expect(result.totals).toMatchObject({ fixed: 0, onRemovedPage: 1 });
  });

  it("warns only when the crawls differ by more than 20 percent", async () => {
    for (let i = 0; i < 5; i++) await page("base", `/p${i}`);
    for (let i = 0; i < 6; i++) await page("target", `/p${i}`);
    for (let i = 0; i < 3; i++) await page("wide", `/p${i}`);

    const close = await AuditCompareService.compare(
      "project_1",
      "base",
      "target",
    );
    const far = await AuditCompareService.compare("project_1", "base", "wide");

    expect(close.coverageWarning).toBeNull();
    expect(far.coverageWarning).toContain("5 vs 3");
  });

  it("lists added, removed and changed pages one page at a time", async () => {
    await page("base", "/same");
    await page("base", "/gone");
    await page("base", "/moved", { status: 200, title: "Old" });
    await page("target", "/same");
    await page("target", "/new-1");
    await page("target", "/new-2");
    await page("target", "/moved", { status: 404, title: "Old" });

    const result = await AuditCompareService.compare(
      "project_1",
      "base",
      "target",
    );
    expect(result.pages).toEqual({ added: 2, removed: 1, changed: 1 });

    const firstAdded = await AuditCompareService.listPages("project_1", {
      baseAuditId: "base",
      targetAuditId: "target",
      kind: "added",
      page: 1,
      pageSize: 1,
    });
    expect(firstAdded.totalCount).toBe(2);
    expect(firstAdded.rows.map((row) => row.url)).toEqual(["/new-1"]);

    const changed = await AuditCompareService.listPages("project_1", {
      baseAuditId: "base",
      targetAuditId: "target",
      kind: "changed",
      page: 1,
      pageSize: 10,
    });
    expect(changed.rows).toMatchObject([
      { url: "/moved", baseStatusCode: 200, statusCode: 404 },
    ]);
  });

  it("compares Lighthouse scores only for pages tested in both audits", async () => {
    const baseHome = await page("base", "/");
    const targetHome = await page("target", "/");
    const targetOther = await page("target", "/other");
    for (const [auditId, pageId, score] of [
      ["base", baseHome, 90],
      ["target", targetHome, 70],
      ["target", targetOther, 50],
    ] as const) {
      rowId += 1;
      await client.execute({
        sql: "INSERT INTO audit_lighthouse_results (id, audit_id, page_id, strategy, performance_score) VALUES (?, ?, ?, 'mobile', ?)",
        args: [`lh_${rowId}`, auditId, pageId, score],
      });
    }

    const result = await AuditCompareService.compare(
      "project_1",
      "base",
      "target",
    );

    expect(result.lighthouse).toMatchObject([
      { url: "/", strategy: "mobile", performanceDelta: -20 },
    ]);
  });

  it("refuses audits that are the same, unfinished, or not in the project", async () => {
    mocks.getAuditForProject.mockImplementation((id) =>
      Promise.resolve(
        id === "never"
          ? null
          : audit(id, id === "busy" ? "running" : "completed"),
      ),
    );

    await expect(
      AuditCompareService.compare("project_1", "base", "base"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      AuditCompareService.compare("project_1", "base", "busy"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      AuditCompareService.compare("project_1", "base", "never"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
