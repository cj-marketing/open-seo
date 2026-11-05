import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBingSearchPerformanceTool,
  getBingTrafficTrendTool,
} from "./bing-webmaster-tools";
import { makeToolContext, textContent } from "./tool-test-support";

const mocks = vi.hoisted(() => ({ getProjectForOrganization: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

const toolContext = makeToolContext();

describe("Bing Webmaster MCP tools", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: "project_1",
      domain: "example.com",
    });
    vi.stubEnv("BING_WEBMASTER_API_KEY", "test-secret-key");
  });

  it("returns a setup hint when the API key is not set", async () => {
    vi.stubEnv("BING_WEBMASTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn());

    const result = await getBingSearchPerformanceTool.handler(
      { projectId: "project_1" },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      ok: false,
      reason: "bing_not_configured",
    });
    expect(textContent(result)).toContain("BING_WEBMASTER_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns daily traffic rows and totals for the project's site", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        Response.json({
          d: url.pathname.endsWith("GetUserSites")
            ? [{ Url: "https://example.com/", IsVerified: true }]
            : [
                {
                  Date: "/Date(1316156400000-0700)/",
                  Impressions: 200,
                  Clicks: 10,
                },
                {
                  Date: "/Date(1316242800000-0700)/",
                  Impressions: 100,
                  Clicks: 5,
                },
              ],
        }),
      ),
    );

    const result = await getBingTrafficTrendTool.handler(
      { projectId: "project_1", days: 28 },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      ok: true,
      siteUrl: "https://example.com/",
      rows: [
        { date: "2011-09-16", impressions: 200, clicks: 10, ctr: 0.05 },
        { date: "2011-09-17", impressions: 100, clicks: 5, ctr: 0.05 },
      ],
      totals: { impressions: 300, clicks: 15 },
    });
  });
});
