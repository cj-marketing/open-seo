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
import type * as CompetitorQueriesModule from "./competitorSnapshotQueries";

// Real in-memory SQLite, so the keep-the-best upsert and the latest / before /
// earliest picks run against actual SQL.

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

let client: Client;
let queries: typeof CompetitorQueriesModule;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  const testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));
  vi.doMock("@/db/runBatch", () => ({
    DB_BATCH_SIZE: 100,
    executeInBatches: async <T>(
      items: T[],
      build: (tx: typeof testDb, item: T) => Promise<unknown>,
    ) => {
      for (const item of items) await build(testDb, item);
    },
  }));

  await client.executeMultiple(`
    CREATE TABLE rank_check_runs (
      id TEXT PRIMARY KEY,
      config_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL
    );
    CREATE TABLE rank_competitor_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      tracking_keyword_id TEXT NOT NULL,
      device TEXT NOT NULL,
      domain TEXT NOT NULL,
      position INTEGER,
      url TEXT,
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX rank_competitor_snapshots_run_keyword_device_domain_idx
      ON rank_competitor_snapshots (run_id, tracking_keyword_id, device, domain);
  `);

  queries = await import("./competitorSnapshotQueries");
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM rank_competitor_snapshots;
    DELETE FROM rank_check_runs;
  `);
});

const read = (position: number | null, url: string | null = null) => ({
  runId: "run_a",
  trackingKeywordId: "kw_0",
  device: "desktop" as const,
  domain: "rival.com",
  position,
  url,
});

const positions = (rows: Array<{ domain: string; position: number | null }>) =>
  Object.fromEntries(rows.map((row) => [row.domain, row.position]));

describe("upsertBestCompetitorSnapshots", () => {
  it("keeps the best position per domain across reads, and a miss never replaces one", async () => {
    const saved = async () =>
      (
        await client.execute(
          "SELECT position, url FROM rank_competitor_snapshots",
        )
      ).rows.map((row) => ({ position: row.position, url: row.url }));

    await queries.upsertBestCompetitorSnapshots([read(null)]);
    expect(await saved()).toEqual([{ position: null, url: null }]);

    for (const next of [
      read(7, "https://rival.com/a"),
      read(9, "https://rival.com/b"),
      read(null),
    ]) {
      await queries.upsertBestCompetitorSnapshots([next]);
    }

    expect(await saved()).toEqual([
      { position: 7, url: "https://rival.com/a" },
    ]);
  });
});

describe("getCompetitorSnapshotsForConfig", () => {
  it("picks the latest, the one before a date, and the earliest read per cell from completed runs of the config", async () => {
    for (const [id, status, startedAt] of [
      ["run_a", "completed", "2026-07-01T10:00:00.000Z"],
      ["run_b", "completed", "2026-07-20T10:00:00.000Z"],
      ["run_active", "running", "2026-07-25T10:00:00.000Z"],
    ]) {
      await client.execute({
        sql: "INSERT INTO rank_check_runs (id, config_id, project_id, status, started_at) VALUES (?, 'cfg_a', 'proj_1', ?, ?)",
        args: [id, status, startedAt],
      });
    }
    for (const [runId, domain, position, checkedAt] of [
      ["run_a", "rival.com", 8, "2026-07-01T10:00:00.000Z"],
      ["run_b", "rival.com", 5, "2026-07-20T10:00:00.000Z"],
      ["run_active", "rival.com", 1, "2026-07-25T10:00:00.000Z"],
      ["run_b", "other.com", null, "2026-07-20T10:00:00.000Z"],
      ["run_b", "untracked.com", 2, "2026-07-20T10:00:00.000Z"],
    ] as const) {
      await client.execute({
        sql: "INSERT INTO rank_competitor_snapshots (run_id, tracking_keyword_id, device, domain, position, checked_at) VALUES (?, 'kw_0', 'desktop', ?, ?, ?)",
        args: [runId, domain, position, checkedAt],
      });
    }
    const domains = ["rival.com", "other.com"];

    const latest = await queries.getCompetitorSnapshotsForConfig("cfg_a", {
      order: "latest",
      domains,
    });
    const before = await queries.getCompetitorSnapshotsForConfig("cfg_a", {
      order: "latest",
      beforeDate: "2026-07-10T00:00:00.000Z",
      domains,
    });
    const earliest = await queries.getCompetitorSnapshotsForConfig("cfg_a", {
      order: "earliest",
      domains,
    });

    expect(positions(latest)).toEqual({ "rival.com": 5, "other.com": null });
    expect(positions(before)).toEqual({ "rival.com": 8 });
    expect(positions(earliest)).toEqual({ "rival.com": 8, "other.com": null });
  });
});
