import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  // AUTH_MODE unset: the deployment holds the DataForSEO key.
  getOptionalEnvValue: vi.fn(async () => undefined),
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
}));

import { fetchRankCheckTaskResult } from "@/server/lib/dataforseo/serp";

function stubSerp(items: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({
        status_code: 20000,
        tasks: [
          {
            id: "task-a",
            status_code: 20000,
            cost: 0,
            path: ["v3", "serp", "google", "organic", "task_get", "advanced"],
            result: [{ items }],
          },
        ],
      }),
    ),
  );
}

const check = (competitorDomains?: string[]) =>
  fetchRankCheckTaskResult({
    taskId: "task-a",
    keywordId: "kw-1",
    keyword: "alpha",
    targetDomain: "example.com",
    competitorDomains,
  });

describe("competitor positions in a rank check", () => {
  it("reads each competitor from the same results, by domain or subdomain, and keeps a missing one as null", async () => {
    stubSerp([
      {
        type: "organic",
        rank_group: 1,
        domain: "rival.com",
        url: "https://rival.com/a",
      },
      {
        type: "organic",
        rank_group: 2,
        domain: "www.example.com",
        url: "https://www.example.com/",
      },
      {
        type: "organic",
        rank_group: 3,
        domain: "blog.rival.com",
        url: "https://blog.rival.com/b",
      },
      // Google /goto wrapper: the site is only in the breadcrumb.
      {
        type: "organic",
        rank_group: 4,
        domain: "google.com",
        url: "https://google.com/goto?url=CAES",
        breadcrumb: "https://www.other.com › page",
      },
    ]);

    const outcome = await check(["rival.com", "other.com", "absent.com"]);

    expect(outcome).toMatchObject({
      status: "completed",
      result: {
        position: 2,
        competitors: [
          { domain: "rival.com", position: 1, url: "https://rival.com/a" },
          { domain: "other.com", position: 4 },
          { domain: "absent.com", position: null, url: null },
        ],
      },
    });
  });

  it("adds no competitor field when none are tracked", async () => {
    stubSerp([{ type: "organic", rank_group: 1, domain: "example.com" }]);

    expect(await check([])).not.toHaveProperty("result.competitors");
    expect(await check()).not.toHaveProperty("result.competitors");
  });
});
