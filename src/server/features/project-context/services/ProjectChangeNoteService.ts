import { ProjectChangeNoteRepository } from "@/server/features/project-context/repositories/ProjectChangeNoteRepository";
import { AppError } from "@/server/lib/errors";
import { CHANGE_NOTE_LIST_LIMIT } from "@/types/schemas/change-notes";
import type { ContextAuthor } from "@/types/schemas/projectContext";

type ChangeNote = {
  id: string;
  noteDate: string;
  label: string;
  createdBy: ContextAuthor;
};

function toChangeNote(row: ChangeNote): ChangeNote {
  return {
    id: row.id,
    noteDate: row.noteDate,
    label: row.label,
    createdBy: row.createdBy,
  };
}

async function addNote(
  projectId: string,
  input: { noteDate: string; label: string },
  createdBy: ContextAuthor,
): Promise<ChangeNote> {
  const row = await ProjectChangeNoteRepository.insert({
    projectId,
    noteDate: input.noteDate,
    label: input.label,
    createdBy,
  });
  return toChangeNote(row);
}

/** Newest change first, capped so a runaway writer cannot bloat a page. */
async function listNotes(projectId: string): Promise<ChangeNote[]> {
  const rows = await ProjectChangeNoteRepository.listByProject(
    projectId,
    CHANGE_NOTE_LIST_LIMIT,
  );
  return rows.map(toChangeNote);
}

async function getNote(projectId: string, noteId: string): Promise<ChangeNote> {
  const row = await ProjectChangeNoteRepository.getById(projectId, noteId);
  if (!row) throw new AppError("NOT_FOUND", "That change note doesn't exist.");
  return toChangeNote(row);
}

async function deleteNote(projectId: string, noteId: string): Promise<void> {
  const deleted = await ProjectChangeNoteRepository.deleteById(
    projectId,
    noteId,
  );
  if (!deleted) {
    throw new AppError("NOT_FOUND", "That change note doesn't exist.");
  }
}

export const ProjectChangeNoteService = {
  addNote,
  listNotes,
  getNote,
  deleteNote,
} as const;
