import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRankCompetitorDomains } from "./rankCompetitors";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));

const mocks = vi.hoisted(() => ({ listCompetitors: vi.fn() }));

vi.mock(
  "@/server/features/project-context/repositories/ProjectContextRepository",
  () => ({
    ProjectContextRepository: { listCompetitors: mocks.listCompetitors },
  }),
);

describe("loadRankCompetitorDomains", () => {
  beforeEach(() => {
    mocks.listCompetitors.mockResolvedValue([]);
  });

  it("leaves out the tracked domain and its subdomains, and normalizes and dedupes the rest", async () => {
    mocks.listCompetitors.mockResolvedValue(
      [
        "example.com",
        "blog.example.com",
        "https://www.Rival.com/pricing",
        "rival.com",
        "other.org",
      ].map((domain) => ({ domain })),
    );

    expect(await loadRankCompetitorDomains("p1", "www.example.com")).toEqual([
      "rival.com",
      "other.org",
    ]);
  });

  it("caps how many competitors each check reads", async () => {
    mocks.listCompetitors.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ domain: `rival${i}.com` })),
    );

    expect(await loadRankCompetitorDomains("p1", "example.com")).toHaveLength(
      10,
    );
  });
});
