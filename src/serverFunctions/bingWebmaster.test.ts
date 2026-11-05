import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { getBingOverview, getBingTable } from "./bingWebmaster";

const { getTrafficTrend, getCrawlHealth, getSearchPerformance } = vi.hoisted(
  () => ({
    getTrafficTrend: vi.fn(),
    getCrawlHealth: vi.fn(),
    getSearchPerformance: vi.fn(),
  }),
);
vi.mock(
  "@/server/features/bing-webmaster/services/BingWebmasterService",
  () => ({
    BingWebmasterService: {
      getTrafficTrend,
      getCrawlHealth,
      getSearchPerformance,
    },
  }),
);
vi.mock("@/serverFunctions/middleware", () => ({ requireProjectContext: [] }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: () => ({
      validator: (schema: z.ZodType) => ({
        handler:
          (
            handler: (input: {
              data: unknown;
              context: { project: { domain: string } };
            }) => unknown,
          ) =>
          ({ data }: { data: unknown }) =>
            handler({
              data: schema.parse(data),
              context: { project: { domain: "example.com" } },
            }),
      }),
    }),
  }),
}));

const overviewInput = { projectId: "p1", days: 28 as const };

describe("Bing server functions", () => {
  beforeEach(() => {
    getTrafficTrend.mockResolvedValue({ ok: true, rows: [] });
    getCrawlHealth.mockResolvedValue({ ok: true });
  });

  it("turns an unmatched Bing site into a status with the visible sites", async () => {
    getTrafficTrend.mockResolvedValue({
      ok: false,
      reason: "bing_site_not_found",
      sites: ["https://other.com/"],
    });
    expect(await getBingOverview({ data: overviewInput })).toEqual({
      status: "site_not_found",
      sites: ["https://other.com/"],
    });
  });

  it("turns an upstream AppError into an error status but lets other errors propagate", async () => {
    getSearchPerformance.mockRejectedValueOnce(new AppError("RATE_LIMITED"));
    const input = { projectId: "p1", dimension: "query" as const, limit: 10 };
    expect(await getBingTable({ data: input })).toEqual({
      status: "error",
      code: "RATE_LIMITED",
    });

    getSearchPerformance.mockRejectedValueOnce(new TypeError("bug"));
    await expect(getBingTable({ data: input })).rejects.toThrow("bug");
  });
});
