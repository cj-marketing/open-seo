import { describe, expect, it } from "vitest";
import { computeImpactWindows } from "@/server/features/gsc/changeNoteImpact";

const base = { earliestDate: "2025-01-01" };

describe("computeImpactWindows", () => {
  it("compares a full window either side and leaves the note's own day out", () => {
    expect(
      computeImpactWindows({
        ...base,
        noteDate: "2026-10-10",
        windowDays: 7,
        latestDate: "2026-11-06",
      }),
    ).toEqual({
      status: "ok",
      comparedDays: 7,
      before: { startDate: "2026-10-03", endDate: "2026-10-09" },
      after: { startDate: "2026-10-11", endDate: "2026-10-17" },
    });
  });

  it("compares only the days GSC has after a recent note, against an equally long before window", () => {
    // Data ends 2026-11-06, so only 11-02..11-06 (5 days) follow a 11-01 note.
    expect(
      computeImpactWindows({
        ...base,
        noteDate: "2026-11-01",
        windowDays: 28,
        latestDate: "2026-11-06",
      }),
    ).toEqual({
      status: "ok",
      comparedDays: 5,
      before: { startDate: "2026-10-27", endDate: "2026-10-31" },
      after: { startDate: "2026-11-02", endDate: "2026-11-06" },
    });
  });

  it("reports no after data when the note is on or past the last complete day", () => {
    for (const noteDate of ["2026-11-06", "2026-11-20"]) {
      expect(
        computeImpactWindows({
          ...base,
          noteDate,
          windowDays: 14,
          latestDate: "2026-11-06",
        }),
      ).toEqual({ status: "no_after_data" });
    }
  });

  it("shortens both sides when the before window would start before GSC's retention", () => {
    expect(
      computeImpactWindows({
        noteDate: "2026-01-04",
        windowDays: 14,
        latestDate: "2026-11-06",
        earliestDate: "2026-01-01",
      }),
    ).toEqual({
      status: "ok",
      comparedDays: 3,
      before: { startDate: "2026-01-01", endDate: "2026-01-03" },
      after: { startDate: "2026-01-05", endDate: "2026-01-07" },
    });
  });

  it("reports no before data for a note older than the retention", () => {
    expect(
      computeImpactWindows({
        noteDate: "2025-12-31",
        windowDays: 14,
        latestDate: "2026-11-06",
        earliestDate: "2026-01-01",
      }),
    ).toEqual({ status: "no_before_data" });
  });
});
