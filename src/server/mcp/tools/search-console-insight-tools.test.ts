import { beforeEach, describe, expect, it, vi } from "vitest";
import { GscNotConnectedError } from "@/server/lib/gscErrors";
import { buildSaveChangeNoteTool } from "./change-note-tools";
import { getSearchConsoleInsightsTool } from "./search-console-insight-tools";
import { makeToolContext, textContent } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  hasGoogleOAuthConfig: vi.fn(),
  getPerformance: vi.fn(),
  addNote: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/google/oauth-config", () => ({
  hasGoogleOAuthConfig: mocks.hasGoogleOAuthConfig,
}));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: mocks.getPerformance },
}));
vi.mock(
  "@/server/features/project-context/services/ProjectChangeNoteService",
  () => ({ ProjectChangeNoteService: { addNote: mocks.addNote } }),
);

const toolContext = makeToolContext();

beforeEach(() => {
  mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
  mocks.hasGoogleOAuthConfig.mockResolvedValue(true);
});

describe("get_search_console_insights", () => {
  it("finds cannibalizing queries from more than the usual 1,000 rows", async () => {
    mocks.getPerformance.mockResolvedValue({
      rows: [
        {
          keys: ["blue shoes", "https://x.test/a"],
          clicks: 3,
          impressions: 80,
          ctr: 0,
          position: 3,
        },
        {
          keys: ["blue shoes", "https://x.test/b#reviews"],
          clicks: 0,
          impressions: 40,
          ctr: 0,
          position: 9,
        },
      ],
    });

    const result = await getSearchConsoleInsightsTool.handler(
      { projectId: "project_1", view: "cannibalization" },
      toolContext,
    );

    expect(mocks.getPerformance).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: ["query", "page"],
        rowLimit: 25000,
      }),
    );
    expect(result.structuredContent).toMatchObject({
      ok: true,
      view: "cannibalization",
      rows: [{ query: "blue shoes", totalImpressions: 120 }],
    });
    expect(textContent(result)).toContain("https://x.test/b (9.0, 40, 0)");
  });

  it("points to the connect page when Search Console is not connected", async () => {
    mocks.getPerformance.mockRejectedValue(
      new GscNotConnectedError("project_1"),
    );

    const result = await getSearchConsoleInsightsTool.handler(
      { projectId: "project_1", view: "decay" },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      ok: false,
      reason: "not_connected",
    });
    expect(textContent(result)).toContain("Connect it here");
  });
});

describe("save_change_note", () => {
  it("records the note under the author the tool was built for", async () => {
    mocks.addNote.mockResolvedValue({
      id: "n1",
      noteDate: "2026-11-01",
      label: "Rewrote titles",
      createdBy: "sam",
    });

    await buildSaveChangeNoteTool("sam").handler(
      { projectId: "project_1", label: "Rewrote titles", date: "2026-11-01" },
      toolContext,
    );

    expect(mocks.addNote).toHaveBeenCalledWith(
      "project_1",
      { noteDate: "2026-11-01", label: "Rewrote titles" },
      "sam",
    );
  });
});
