import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeNoteImpactService } from "./ChangeNoteImpactService";

const mocks = vi.hoisted(() => ({
  getPerformance: vi.fn(),
  getNote: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: mocks.getPerformance },
}));
vi.mock(
  "@/server/features/project-context/services/ProjectChangeNoteService",
  () => ({ ProjectChangeNoteService: { getNote: mocks.getNote } }),
);

const rowFor = (dimension: string, clicks: number) => ({
  keys: [dimension],
  clicks,
  impressions: clicks * 10,
  ctr: 0.1,
  position: 4,
});

beforeEach(() => {
  // GSC data then ends 2026-11-06.
  vi.useFakeTimers({ now: new Date("2026-11-09T12:00:00Z") });
  mocks.getNote.mockResolvedValue({
    id: "n1",
    noteDate: "2026-11-01",
    label: "Rewrote titles",
    createdBy: "user",
  });
  mocks.getPerformance.mockImplementation(
    (input: { startDate: string; dimensions: string[] }) =>
      Promise.resolve({
        // The before window (October) has less traffic than the after window.
        rows: [
          rowFor(
            input.dimensions[0] === "date" ? input.startDate : "/page",
            input.startDate < "2026-11-01" ? 1 : 2,
          ),
        ],
      }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChangeNoteImpactService.getImpact", () => {
  it("compares only the days available after a recent note against as many days before, filtered by page", async () => {
    const impact = await ChangeNoteImpactService.getImpact("p1", {
      noteId: "n1",
      windowDays: 28,
      pageContains: "/blog/",
    });

    if (impact.status !== "ok") throw new Error("expected an ok impact");
    expect(impact.comparedDays).toBe(5);
    expect(impact.windowDays).toBe(28);
    expect(impact.before).toMatchObject({
      startDate: "2026-10-27",
      endDate: "2026-10-31",
    });
    expect(impact.after).toMatchObject({
      startDate: "2026-11-02",
      endDate: "2026-11-06",
    });
    expect(impact.topGains[0]).toMatchObject({
      key: "/page",
      beforeClicks: 1,
      afterClicks: 2,
    });
    expect(mocks.getPerformance).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          { dimension: "page", operator: "contains", expression: "/blog/" },
        ],
      }),
    );
  });

  it("asks Google for nothing when no complete day follows the note", async () => {
    mocks.getNote.mockResolvedValue({
      id: "n1",
      noteDate: "2026-11-08",
      label: "Too fresh",
      createdBy: "user",
    });
    const impact = await ChangeNoteImpactService.getImpact("p1", {
      noteId: "n1",
      windowDays: 7,
    });
    expect(impact.status).toBe("no_after_data");
    expect(mocks.getPerformance).not.toHaveBeenCalled();
  });
});
