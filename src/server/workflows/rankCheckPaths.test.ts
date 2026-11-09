import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import type { RankCheckTaskInput } from "@/server/lib/dataforseo";
import { retryRankChecks } from "./rankCheckRetries";
import {
  expandToTaskInputs,
  runQueuedCheck,
  runQueuedTasks,
} from "./rankCheckPaths";

const mocks = vi.hoisted(() => ({
  getSnapshotsForRun: vi.fn(),
  getBestPositionsForKeywords: vi.fn(),
  upsertSnapshots: vi.fn(),
  insertSnapshots: vi.fn(),
  updateRun: vi.fn(),
  upsertBestCompetitorSnapshots: vi.fn(),
  deleteNotFoundSnapshots: vi.fn(),
  fetchRankCheckTaskResult: vi.fn(),
  rankCheckTaskPost: vi.fn(),
}));

vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: mocks }),
);
vi.mock("@/server/lib/dataforseo", () => ({
  fetchRankCheckTaskResult: mocks.fetchRankCheckTaskResult,
  MAX_TASKS_PER_POST: 100,
}));
vi.mock("@/server/workflows/pgStep", () => ({
  pgStep: (
    _step: unknown,
    _name: string,
    _config: unknown,
    fn: () => unknown,
  ) => fn(),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only sleep is reached; pgStep is mocked
const step = { sleep: vi.fn() } as unknown as WorkflowStep;

function checkContext(
  keywordIds: string[],
  devices: "desktop" | "both" = "desktop",
  competitors?: string[],
) {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the check paths only call this serp method
    client: { serp: { rankCheckTaskPost: mocks.rankCheckTaskPost } } as never,
    keywords: keywordIds.map((id) => ({ id, keyword: `keyword ${id}` })),
    devices,
    serpDepth: 10,
    domain: "openseo.so",
    locationCode: 2840,
    languageCode: "en",
    runId: "run_1",
    competitors,
  };
}

function snapshot(keywordId: string, position: number | null) {
  return { trackingKeywordId: keywordId, device: "desktop", position };
}

/** Each task_get answers with the next position. */
function queuedResults(...positions: Array<number | null>) {
  for (const position of positions) {
    mocks.fetchRankCheckTaskResult.mockImplementationOnce(
      async (task: RankCheckTaskInput) => ({
        status: "completed",
        result: { ...task, position, url: null, serpFeatures: [] },
      }),
    );
  }
}

function retry(ctx: ReturnType<typeof checkContext>, readsEndAt = Infinity) {
  return retryRankChecks(step, ctx, "config_1", readsEndAt);
}

beforeEach(() => {
  mocks.upsertBestCompetitorSnapshots.mockResolvedValue(undefined);
  mocks.rankCheckTaskPost.mockImplementation(
    async ({ tasks }: { tasks: RankCheckTaskInput[] }) =>
      tasks.map((task) => ({ ...task, taskId: `task_${task.keywordId}` })),
  );
  mocks.fetchRankCheckTaskResult.mockImplementation(
    async (task: RankCheckTaskInput) => ({
      status: "completed",
      result: { ...task, position: null, url: null, serpFeatures: [] },
    }),
  );
  mocks.getBestPositionsForKeywords.mockResolvedValue([
    { trackingKeywordId: "kw_0", position: 1 },
    { trackingKeywordId: "kw_never", position: null },
  ]);
});

describe("retryRankChecks", () => {
  it("gives a keyword three reads even when the first looks fine, then stops once they agree", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue([snapshot("kw_new", 5)]);
    queuedResults(4, 6);

    await retry(checkContext(["kw_new"]));

    expect(mocks.rankCheckTaskPost).toHaveBeenCalledTimes(2);
    expect(mocks.upsertSnapshots).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ trackingKeywordId: "kw_new", position: 4 }),
    ]);
  });

  it.each([
    ["positions differ by more than two places", [3, 9, 8, 7, 6]],
    ["a read misses the site", [null, 3, 5, 5, 5]],
  ])(
    "reads up to six times when %s, keeping the best position",
    async (_label, laterReads) => {
      mocks.getSnapshotsForRun.mockResolvedValue([snapshot("kw_new", 5)]);
      queuedResults(...laterReads);

      await retry(checkContext(["kw_new"]));

      expect(mocks.rankCheckTaskPost).toHaveBeenCalledTimes(5);
      expect(mocks.upsertSnapshots).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({ position: 3 }),
      ]);
    },
  );

  it("starts no more reads once the read window has passed, and still drops misses", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue([snapshot("kw_0", null)]);

    await retry(checkContext(["kw_0"]), Date.now() - 1);

    expect(mocks.rankCheckTaskPost).not.toHaveBeenCalled();
    expect(mocks.deleteNotFoundSnapshots).toHaveBeenCalledExactlyOnceWith([
      { runId: "run_1", trackingKeywordId: "kw_0", device: "desktop" },
    ]);
  });

  it("saves a not found for a keyword that never ranked once a read answers", async () => {
    // The first read errored, so there is no row yet.
    mocks.getSnapshotsForRun.mockResolvedValue([]);

    await retry(checkContext(["kw_never"]));

    expect(mocks.rankCheckTaskPost).toHaveBeenCalledTimes(5);
    expect(mocks.upsertSnapshots).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({
        trackingKeywordId: "kw_never",
        position: null,
      }),
    ]);
    expect(mocks.deleteNotFoundSnapshots).not.toHaveBeenCalled();
  });

  it("finds a new keyword on a later read after earlier ones miss", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue([snapshot("kw_new", null)]);
    queuedResults(null, null, null, 3, null);

    await retry(checkContext(["kw_new"]));

    expect(mocks.upsertSnapshots).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ trackingKeywordId: "kw_new", position: 3 }),
    ]);
    expect(mocks.deleteNotFoundSnapshots).not.toHaveBeenCalled();
  });

  it("never saves a not found for a keyword that ranked before", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue([snapshot("kw_0", null)]);

    await retry(checkContext(["kw_0"]));

    expect(mocks.rankCheckTaskPost).toHaveBeenCalledTimes(5);
    expect(mocks.upsertSnapshots).not.toHaveBeenCalled();
    expect(mocks.deleteNotFoundSnapshots).toHaveBeenCalledExactlyOnceWith([
      { runId: "run_1", trackingKeywordId: "kw_0", device: "desktop" },
    ]);
  });

  it("drops a device's miss when the keyword ranks on the other device in this run", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue([
      snapshot("kw_never", null),
      { ...snapshot("kw_never", 3), device: "mobile" },
    ]);

    await retry(checkContext(["kw_never"], "both"));

    expect(mocks.deleteNotFoundSnapshots).toHaveBeenCalledExactlyOnceWith([
      { runId: "run_1", trackingKeywordId: "kw_never", device: "desktop" },
    ]);
  });
});

const rival = (position: number | null) => ({
  domain: "rival.com",
  position,
  url: position === null ? null : "https://rival.com/page",
});

describe("competitor positions", () => {
  /** Each task_get answers with the next position for us and the rival. */
  function queuedPairs(...reads: Array<[number | null, number | null]>) {
    for (const [own, rivalPosition] of reads) {
      mocks.fetchRankCheckTaskResult.mockImplementationOnce(
        async (task: RankCheckTaskInput) => ({
          status: "completed",
          result: {
            ...task,
            position: own,
            url: null,
            serpFeatures: [],
            competitors: [rival(rivalPosition)],
          },
        }),
      );
    }
  }

  it("posts exactly the tasks it posts without competitors", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue([snapshot("kw_new", 5)]);
    queuedResults(4, 6);
    await retry(checkContext(["kw_new"]));
    const withoutCompetitors = [...mocks.rankCheckTaskPost.mock.calls];
    expect(withoutCompetitors).toHaveLength(2);

    mocks.rankCheckTaskPost.mockClear();
    queuedPairs([4, 9], [6, 8]);
    await retry(checkContext(["kw_new"], "desktop", ["rival.com"]));

    expect(mocks.rankCheckTaskPost.mock.calls).toEqual(withoutCompetitors);
  });

  it("saves every read of a competitor, including a read where our position is settled", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue([snapshot("kw_new", 5)]);
    queuedPairs([5, 7], [5, null]);

    await retry(checkContext(["kw_new"], "desktop", ["rival.com"]));

    const row = (position: number | null) => [
      [
        {
          runId: "run_1",
          trackingKeywordId: "kw_new",
          device: "desktop",
          ...rival(position),
        },
      ],
    ];
    expect(mocks.upsertBestCompetitorSnapshots.mock.calls).toEqual([
      row(7),
      row(null),
    ]);
  });

  it("keeps our own snapshot and the run going when saving competitors fails", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue([snapshot("kw_new", 5)]);
    mocks.upsertBestCompetitorSnapshots.mockRejectedValue(new Error("db"));
    queuedPairs([4, 9], [6, 8]);

    await retry(checkContext(["kw_new"], "desktop", ["rival.com"]));

    expect(mocks.upsertSnapshots).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ trackingKeywordId: "kw_new", position: 4 }),
    ]);
  });

  it("saves the first read's competitors after our own snapshot, even when that fails", async () => {
    mocks.upsertBestCompetitorSnapshots.mockRejectedValue(new Error("db"));
    queuedPairs([3, 6]);

    await runQueuedCheck(
      step,
      checkContext(["kw_new"], "desktop", ["rival.com"]),
    );

    expect(mocks.insertSnapshots).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ trackingKeywordId: "kw_new", position: 3 }),
    ]);
    expect(mocks.upsertBestCompetitorSnapshots).toHaveBeenCalledOnce();
  });

  it("keeps competitor reads out of the collected results, which the workflow stores between steps", async () => {
    queuedPairs([3, 6]);
    const ctx = checkContext(["kw_new"], "desktop", ["rival.com"]);

    const collected = await runQueuedTasks(
      step,
      ctx,
      expandToTaskInputs(ctx.keywords, ctx.devices),
      "",
    );

    expect(collected).toHaveLength(1);
    expect(collected[0]).not.toHaveProperty("competitors");
  });
});
