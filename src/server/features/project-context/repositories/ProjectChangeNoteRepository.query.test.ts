import { readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as ProjectChangeNoteRepositoryModule from "./ProjectChangeNoteRepository";

// Real in-memory SQLite, with the table created from the real migration, so
// the ordering and the project scoping run as generated SQL.

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

let client: Client;
let ProjectChangeNoteRepository: typeof ProjectChangeNoteRepositoryModule.ProjectChangeNoteRepository;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  vi.doMock("@/db", () => ({ db: drizzle(client) }));
  await client.executeMultiple(
    [
      `CREATE TABLE projects (id text PRIMARY KEY);`,
      `INSERT INTO projects (id) VALUES ('proj_1'), ('proj_2');`,
      readFileSync("drizzle/sqlite/0070_complete_sway.sql", "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    ].join("\n"),
  );
  ({ ProjectChangeNoteRepository } =
    await import("./ProjectChangeNoteRepository"));
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  await client.execute("DELETE FROM project_change_notes");
});

describe("ProjectChangeNoteRepository", () => {
  it("lists a project's notes newest change first and never another project's", async () => {
    const insert = (projectId: string, noteDate: string, label: string) =>
      ProjectChangeNoteRepository.insert({
        projectId,
        noteDate,
        label,
        createdBy: "user",
      });
    await insert("proj_1", "2026-10-01", "older");
    await insert("proj_1", "2026-10-20", "newer");
    await insert("proj_2", "2026-10-25", "other project");

    const rows = await ProjectChangeNoteRepository.listByProject("proj_1", 10);
    expect(rows.map((row) => row.label)).toEqual(["newer", "older"]);
  });

  it("deletes only within the project it is asked for", async () => {
    const note = await ProjectChangeNoteRepository.insert({
      projectId: "proj_1",
      noteDate: "2026-10-01",
      label: "x",
      createdBy: "mcp",
    });
    expect(
      await ProjectChangeNoteRepository.deleteById("proj_2", note.id),
    ).toBe(false);
    expect(
      await ProjectChangeNoteRepository.getById("proj_1", note.id),
    ).not.toBe(null);
    expect(
      await ProjectChangeNoteRepository.deleteById("proj_1", note.id),
    ).toBe(true);
  });
});
