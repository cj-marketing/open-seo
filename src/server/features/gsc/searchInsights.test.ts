import { describe, expect, it } from "vitest";
import {
  buildCannibalizationRows,
  buildDecayRows,
  topGainsAndLosses,
} from "@/server/features/gsc/searchInsights";

const row = (
  keys: string[],
  clicks: number,
  impressions: number,
  position = 5,
) => ({ keys, clicks, impressions, ctr: 0, position });

describe("buildDecayRows", () => {
  it("keeps only keys with 50+ earlier impressions that lost, sorted by lost clicks then lost impressions", () => {
    const rows = buildDecayRows(
      [
        row(["/small"], 0, 49), // under the floor
        row(["/steady"], 5, 100),
        row(["/up"], 1, 60),
        row(["/lost-clicks"], 10, 200),
        row(["/lost-impressions-a"], 0, 300),
        row(["/lost-impressions-b"], 0, 100),
        row(["/gone"], 0, 80), // not in the current period at all
      ],
      [
        row(["/small"], 0, 0),
        row(["/steady"], 5, 100),
        row(["/up"], 3, 90),
        row(["/lost-clicks"], 4, 190),
        row(["/lost-impressions-a"], 0, 100),
        row(["/lost-impressions-b"], 0, 90),
      ],
    );
    expect(rows.map((r) => r.key)).toEqual([
      "/lost-clicks",
      "/lost-impressions-a", // -200 impressions
      "/gone", // -80
      "/lost-impressions-b", // -10
    ]);
    expect(rows[0]).toMatchObject({
      clicksDelta: -6,
      impressionsDelta: -10,
      beforePosition: 5,
    });
    expect(rows[2]).toMatchObject({ afterImpressions: 0, afterPosition: null });
  });
});

describe("topGainsAndLosses", () => {
  it("ranks gains and losses on opposite ends of the same click-then-impression order", () => {
    const { gains, losses } = topGainsAndLosses(
      [row(["/a"], 2, 100), row(["/b"], 5, 100), row(["/c"], 0, 50)],
      [row(["/a"], 6, 100), row(["/b"], 1, 100), row(["/c"], 0, 90)],
      1,
    );
    expect(gains.map((r) => r.key)).toEqual(["/a"]);
    expect(losses.map((r) => r.key)).toEqual(["/b"]);
  });
});

describe("buildCannibalizationRows", () => {
  it("merges URL fragments before counting pages, so a page does not compete with itself", () => {
    const rows = buildCannibalizationRows([
      row(["blue shoes", "https://x.test/shoes"], 1, 60, 4),
      row(["blue shoes", "https://x.test/shoes#reviews"], 1, 40, 8),
    ]);
    expect(rows).toEqual([]);
  });

  it("weights position by impressions and applies the 10 impression and 10 percent thresholds", () => {
    const [result, ...rest] = buildCannibalizationRows([
      row(["q"], 0, 1), // ignored: no page key
      row(["blue shoes", "https://x.test/a"], 2, 80, 3),
      row(["blue shoes", "https://x.test/a#top"], 1, 20, 8),
      row(["blue shoes", "https://x.test/b"], 0, 25, 12),
      // 5 impressions: under 10, so it is not a competitor
      row(["blue shoes", "https://x.test/c"], 0, 5, 2),
    ]);
    expect(rest).toEqual([]);
    expect(result).toMatchObject({
      query: "blue shoes",
      totalClicks: 3,
      totalImpressions: 130,
      pageCount: 3,
    });
    expect(result.pages.map((p) => p.page)).toEqual([
      "https://x.test/a",
      "https://x.test/b",
    ]);
    // (3*80 + 8*20) / 100
    expect(result.pages[0].position).toBeCloseTo(4);
    expect(result.pages[0].share).toBeCloseTo(100 / 130);
  });

  it("drops a page under 10 percent of the query's impressions and sorts queries by total impressions", () => {
    const result = buildCannibalizationRows([
      // 12 of 200 impressions is 6 percent: only one real page is left.
      row(["small", "https://x.test/a"], 0, 188),
      row(["small", "https://x.test/b"], 0, 12),
      row(["big", "https://x.test/a"], 0, 500),
      row(["big", "https://x.test/b"], 0, 400),
      row(["mid", "https://x.test/a"], 0, 50),
      row(["mid", "https://x.test/b"], 0, 40),
    ]);
    expect(result.map((r) => r.query)).toEqual(["big", "mid"]);
  });
});
