import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestResults } from "./rankTrackingResults";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));

const mocks = vi.hoisted(() => ({
  getConfigById: vi.fn(),
  getKeywordsForConfig: vi.fn(),
  getLatestSnapshotsForKeywords: vi.fn(),
  getSnapshotsBeforeDate: vi.fn(),
  getLatestRunForConfig: vi.fn(),
  getEarliestSnapshotsForKeywords: vi.fn(),
  getCompetitorSnapshotsForConfig: vi.fn(),
  listCompetitors: vi.fn(),
}));

vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: mocks }),
);

vi.mock(
  "@/server/features/project-context/repositories/ProjectContextRepository",
  () => ({
    ProjectContextRepository: { listCompetitors: mocks.listCompetitors },
  }),
);

const competitorRead = (
  device: "desktop" | "mobile",
  runId: string,
  position: number | null,
) => ({
  runId,
  trackingKeywordId: "kw_1",
  device,
  domain: "rival.com",
  position,
  url: null,
  checkedAt: "2026-08-01 10:00:00",
});

describe("getLatestResults", () => {
  beforeEach(() => {
    mocks.getConfigById.mockResolvedValue({
      id: "config_1",
      domain: "example.com",
    });
    mocks.listCompetitors.mockResolvedValue([]);
    mocks.getCompetitorSnapshotsForConfig.mockResolvedValue([]);
    mocks.getKeywordsForConfig.mockResolvedValue([]);
    mocks.getLatestSnapshotsForKeywords.mockResolvedValue([]);
    mocks.getSnapshotsBeforeDate.mockResolvedValue([]);
    mocks.getEarliestSnapshotsForKeywords.mockResolvedValue([]);
  });

  it("keeps snapshot freshness when a newer run fails before writing snapshots", async () => {
    mocks.getKeywordsForConfig.mockResolvedValue([
      {
        id: "kw_1",
        keyword: "open seo",
        searchVolume: 100,
        keywordDifficulty: 10,
        cpc: 1,
      },
    ]);
    mocks.getLatestSnapshotsForKeywords.mockResolvedValue([
      {
        trackingKeywordId: "kw_1",
        device: "desktop",
        runId: "run_1",
        checkedAt: "2026-08-01 10:00:00",
        position: 3,
        url: "https://example.com/",
        serpFeatures: null,
      },
    ]);
    mocks.getLatestRunForConfig.mockResolvedValue({
      id: "run_2",
      status: "failed",
      errorMessage: "Provider request timed out",
    });

    await expect(
      getLatestResults("config_1", "project_1"),
    ).resolves.toMatchObject({
      run: {
        id: "run_2",
        lastCheckedAt: "2026-08-01 10:00:00",
        status: "failed",
        errorMessage: "Provider request timed out",
      },
    });
  });

  it("hides a running run's first-pass error while its retries are still going", async () => {
    mocks.getLatestRunForConfig.mockResolvedValue({
      id: "run_3",
      status: "running",
      errorMessage: "UPSTREAM_UNAVAILABLE",
    });

    await expect(
      getLatestResults("config_1", "project_1"),
    ).resolves.toMatchObject({
      run: { id: "run_3", status: "running", errorMessage: null },
    });
  });

  describe("with competitors", () => {
    beforeEach(() => {
      mocks.getKeywordsForConfig.mockResolvedValue([
        { id: "kw_1", keyword: "a" },
      ]);
      mocks.listCompetitors.mockResolvedValue([
        { domain: "example.com" },
        { domain: "rival.com" },
      ]);
    });

    it("leaves competitors out unless asked for", async () => {
      const results = await getLatestResults("config_1", "project_1");

      expect(results).not.toHaveProperty("competitors");
      expect(results.rows[0]).not.toHaveProperty("competitors");
      expect(mocks.getCompetitorSnapshotsForConfig).not.toHaveBeenCalled();
    });

    it("reads the project's competitors but not the tracked domain, with the earliest read as the baseline", async () => {
      mocks.getCompetitorSnapshotsForConfig.mockImplementation(
        async (
          _configId: string,
          opts: { order: string; beforeDate?: string },
        ) =>
          opts.order === "latest" && !opts.beforeDate
            ? [competitorRead("desktop", "run_2", 4)]
            : opts.order === "earliest"
              ? [competitorRead("desktop", "run_1", 9)]
              : [],
      );

      const results = await getLatestResults("config_1", "project_1", "7d", {
        includeCompetitors: true,
      });

      expect(results.competitors).toEqual(["rival.com"]);
      expect(results.rows[0].competitors).toMatchObject([
        {
          domain: "rival.com",
          desktop: { position: 4, previousPosition: 9 },
          // No check has read the rival on mobile: no data, not "not found".
          mobile: {
            position: null,
            previousPosition: null,
            rankingUrl: null,
            checkedAt: null,
          },
        },
      ]);
    });

    it("keeps a competitor the check did not find as a null position with a check date, and no baseline from the same run", async () => {
      mocks.getCompetitorSnapshotsForConfig.mockImplementation(
        async (
          _configId: string,
          opts: { order: string; beforeDate?: string },
        ) =>
          opts.beforeDate ? [] : [competitorRead("desktop", "run_2", null)],
      );

      const results = await getLatestResults("config_1", "project_1", "7d", {
        includeCompetitors: true,
      });

      expect(results.rows[0].competitors?.[0].desktop).toMatchObject({
        position: null,
        previousPosition: null,
        checkedAt: "2026-08-01 10:00:00",
      });
    });

    it("still returns our own positions when competitor positions cannot be read", async () => {
      mocks.getCompetitorSnapshotsForConfig.mockRejectedValue(new Error("db"));

      const results = await getLatestResults("config_1", "project_1", "7d", {
        includeCompetitors: true,
      });

      expect(results.rows).toHaveLength(1);
      expect(results).not.toHaveProperty("competitors");
    });
  });
});
