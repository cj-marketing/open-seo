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
