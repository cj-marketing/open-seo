import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectChangeNotes } from "@/db/schema";
import type { ContextAuthor } from "@/types/schemas/projectContext";

async function insert(values: {
  projectId: string;
  noteDate: string;
  label: string;
  createdBy: ContextAuthor;
}) {
  const row = {
    id: crypto.randomUUID(),
    // Stamped here, not by the column default, so ordering by created_at is
    // lexicographic on one format for both dialects.
    createdAt: new Date().toISOString(),
    ...values,
  };
  await db.insert(projectChangeNotes).values(row);
  return row;
}

async function listByProject(projectId: string, limit: number) {
  return db
    .select()
    .from(projectChangeNotes)
    .where(eq(projectChangeNotes.projectId, projectId))
    .orderBy(
      desc(projectChangeNotes.noteDate),
      desc(projectChangeNotes.createdAt),
      desc(projectChangeNotes.id),
    )
    .limit(limit);
}

async function getById(projectId: string, id: string) {
  const rows = await db
    .select()
    .from(projectChangeNotes)
    .where(
      and(
        eq(projectChangeNotes.projectId, projectId),
        eq(projectChangeNotes.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function deleteById(projectId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(projectChangeNotes)
    .where(
      and(
        eq(projectChangeNotes.projectId, projectId),
        eq(projectChangeNotes.id, id),
      ),
    )
    .returning({ id: projectChangeNotes.id });
  return deleted.length > 0;
}

export const ProjectChangeNoteRepository = {
  insert,
  listByProject,
  getById,
  deleteById,
} as const;
