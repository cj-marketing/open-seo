import { beforeEach, describe, expect, it, vi } from "vitest";
import { BingWebmasterService } from "./BingWebmasterService";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const API_KEY = "test-secret-key";
const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function mockBing(sites: unknown[], methods: Record<string, unknown> = {}) {
  fetchMock.mockImplementation(async (url: URL) => {
    const method = url.pathname.split("/").pop() ?? "";
    return jsonResponse({
      d: method === "GetUserSites" ? sites : methods[method],
    });
  });
}

const site = (Url: string, IsVerified = true) => ({ Url, IsVerified });

const bingDate = (isoDate: string) => `/Date(${Date.parse(isoDate)})/`;

const statsRow = (
  Query: string,
  Date: string,
  Impressions: number,
  Clicks: number,
  position: number,
) => ({
  Query,
  Date,
  Impressions,
  Clicks,
  AvgImpressionPosition: position,
  AvgClickPosition: position,
});

describe("BingWebmasterService", () => {
  beforeEach(() => {
    vi.stubEnv("BING_WEBMASTER_API_KEY", API_KEY);
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sums weekly rows per query with weighted positions and parses both date forms", async () => {
    mockBing([site("https://example.com/")], {
      GetQueryStats: [
        statsRow("shoes", "/Date(1316156400000-0700)/", 100, 10, 2),
        statsRow("shoes", "/Date(1316761200000)/", 300, 0, 6),
        statsRow("shoes", "/Date(1317366000000)/", 0, 0, 99),
        statsRow("rare", "/Date(1316156400000-0700)/", 5, 0, 1),
      ],
    });

    const result = await BingWebmasterService.getSearchPerformance(
      "example.com",
      { dimension: "query", limit: 10, minImpressions: 10 },
    );

    expect(result).toMatchObject({
      ok: true,
      startDate: "2011-09-16",
      endDate: "2011-09-30",
      matchingRowCount: 1,
      rows: [
        {
          key: "shoes",
          impressions: 400,
          clicks: 10,
          ctr: 0.025,
          avgImpressionPosition: 5,
          avgClickPosition: 2,
          weeks: 3,
        },
      ],
    });
  });

  it("only counts weekly rows whose date is inside the window and matches the filter", async () => {
    mockBing([site("https://example.com/")], {
      GetQueryStats: [
        statsRow("shoes", bingDate("2026-10-01"), 100, 10, 2),
        statsRow("shoes", bingDate("2026-10-27"), 50, 5, 4),
        statsRow("boots", bingDate("2026-10-27"), 70, 7, 6),
      ],
    });

    const result = await BingWebmasterService.getSearchPerformance(
      "example.com",
      {
        dimension: "query",
        limit: 10,
        window: { startDate: "2026-10-20", endDate: "2026-11-02" },
        filter: { operator: "contains", expression: "SHO" },
      },
    );

    expect(result).toMatchObject({
      matchingRowCount: 1,
      rows: [{ key: "shoes", impressions: 50, clicks: 5, weeks: 1 }],
    });
  });

  it("builds window totals, a weighted position and striking distance, and treats a previous window beyond Bing's history as unavailable", async () => {
    mockBing([site("https://example.com/")], {
      GetRankAndTrafficStats: [
        { Date: bingDate("2026-10-01"), Impressions: 50, Clicks: 5 },
        { Date: bingDate("2026-10-10"), Impressions: 100, Clicks: 10 },
        { Date: bingDate("2026-10-20"), Impressions: 200, Clicks: 20 },
      ],
      GetQueryStats: [
        statsRow("near", bingDate("2026-10-20"), 300, 0, 8),
        statsRow("top", bingDate("2026-10-20"), 100, 0, 2),
      ],
    });
    const window = { startDate: "2026-10-15", endDate: "2026-10-25" };

    const withHistory = await BingWebmasterService.getReport("example.com", {
      window,
      previousWindow: { startDate: "2026-10-02", endDate: "2026-10-14" },
    });
    const beyondHistory = await BingWebmasterService.getReport("example.com", {
      window,
      previousWindow: { startDate: "2026-09-20", endDate: "2026-10-09" },
    });

    expect(withHistory).toMatchObject({
      totals: { clicks: 20, impressions: 200, ctr: 0.1, position: 6.5 },
      prevTotals: { clicks: 10, impressions: 100 },
      strikingDistance: [{ query: "near", impressions: 300, position: 8 }],
    });
    expect(beyondHistory).toMatchObject({
      prevTotals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    });
  });

  // Seen live: Bing sends AvgClickPosition -1 for rows that have clicks but no
  // click position, which averaged into a position of -1.
  it("treats Bing's -1 position as missing", async () => {
    mockBing([site("https://example.com/")], {
      GetQueryStats: [
        {
          ...statsRow("brand", "/Date(1316156400000)/", 50, 5, 3),
          AvgClickPosition: -1,
        },
      ],
    });

    const result = await BingWebmasterService.getSearchPerformance(
      "example.com",
      { dimension: "query", limit: 10 },
    );

    expect(result).toMatchObject({
      rows: [
        { key: "brand", avgImpressionPosition: 3, avgClickPosition: null },
      ],
    });
  });

  it("matches the project domain to a verified site ignoring www, protocol and slash", async () => {
    mockBing(
      [
        site("https://other.com/"),
        site("http://www.example.com/", false),
        site("http://WWW.Example.com"),
      ],
      {
        GetRankAndTrafficStats: [],
      },
    );

    const result = await BingWebmasterService.getTrafficTrend(
      "https://example.com/",
      { days: 7 },
    );

    expect(result).toMatchObject({
      ok: true,
      siteUrl: "http://WWW.Example.com",
    });
    const trafficCall = new URL(String(fetchMock.mock.lastCall?.[0]));
    expect(trafficCall.searchParams.get("siteUrl")).toBe(
      "http://WWW.Example.com",
    );
  });

  it("lists visible sites when none matches", async () => {
    mockBing([site("https://other.com/")]);

    const result = await BingWebmasterService.getTrafficTrend("example.com", {
      days: 7,
    });

    expect(result).toEqual({
      ok: false,
      reason: "bing_site_not_found",
      sites: ["https://other.com/"],
    });
  });

  it("decodes crawl issue flags and sorts issues by inbound links", async () => {
    mockBing([site("https://example.com/")], {
      GetCrawlStats: [],
      GetCrawlIssues: [
        { Url: "https://example.com/a", HttpCode: 200, Issues: 1, InLinks: 1 },
        {
          Url: "https://example.com/b",
          HttpCode: 404,
          Issues: 4 | 16 | 256,
          InLinks: 9,
        },
      ],
    });

    const result = await BingWebmasterService.getCrawlHealth("example.com", {
      issueLimit: 5,
    });

    expect(result).toMatchObject({
      ok: true,
      issues: [
        {
          url: "https://example.com/b",
          issues: ["Code4xx", "BlockedByRobotsTxt", "TimeOutErrors"],
        },
        { url: "https://example.com/a", issues: ["Code301"] },
      ],
    });
  });

  it("turns an invalid key into an error that does not leak the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      jsonResponse({ ErrorCode: 3, Message: "InvalidApiKey" }, 400),
    );

    const error = await BingWebmasterService.getTrafficTrend("example.com", {
      days: 7,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(String(error)).not.toContain(API_KEY);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(API_KEY);
  });
});
