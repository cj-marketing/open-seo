import { z } from "zod";
import { ProjectChangeNoteService } from "@/server/features/project-context/services/ProjectChangeNoteService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable } from "@/server/mcp/table";
import {
  addChangeNoteSchema,
  CHANGE_NOTE_LABEL_MAX,
} from "@/types/schemas/change-notes";
import type { ContextAuthor } from "@/types/schemas/projectContext";

const changesPath = (projectId: string) => `/p/${projectId}/search-performance`;

const saveInputSchema = {
  projectId: projectIdSchema,
  label: z
    .string()
    .trim()
    .min(1)
    .max(CHANGE_NOTE_LABEL_MAX)
    .describe(
      `What changed, in a few words (max ${CHANGE_NOTE_LABEL_MAX} characters), e.g. "Rewrote /pricing title and H1".`,
    ),
  date: addChangeNoteSchema.shape.noteDate
    .optional()
    .describe(
      "The day the change went live, YYYY-MM-DD. Defaults to today (UTC).",
    ),
} as const;

/**
 * SAM writes through this exact tool (adapted in samChatTools), so the author
 * recorded on every note is the one difference between the two callers.
 */
export function buildSaveChangeNoteTool(author: ContextAuthor) {
  return {
    name: "save_change_note",
    config: {
      title: "Save change note",
      description:
        "Records a dated note about a change made to the site (new page, rewritten title, redirect, release). The note shows as a marker on the Search Performance chart, and get_change_note_impact compares Search Console before and after it. Uses no credits. Save one only for a change that actually went live, with the day it did.",
      inputSchema: saveInputSchema,
      outputSchema: z.looseObject({
        note: looseObjectOutputSchema,
        ...optionalMetaOutputSchema,
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    handler: withMcpProjectAuth(
      async (args: z.infer<z.ZodObject<typeof saveInputSchema>>, context) => {
        const note = await ProjectChangeNoteService.addNote(
          args.projectId,
          {
            noteDate: args.date ?? new Date().toISOString().slice(0, 10),
            label: args.label,
          },
          author,
        );
        return mcpResponse({
          text: `Saved change note for ${note.noteDate}: ${note.label} (id ${note.id}).`,
          meta: buildProjectMeta(
            context,
            args.projectId,
            changesPath(args.projectId),
          ),
          structuredContent: { note },
        });
      },
    ),
  };
}

export const saveChangeNoteTool = buildSaveChangeNoteTool("mcp");

const listInputSchema = { projectId: projectIdSchema } as const;

export const listChangeNotesTool = {
  name: "list_change_notes",
  config: {
    title: "List change notes",
    description:
      "Lists the project's change notes, newest first (up to 200): the dated record of what was changed on the site. Pass a note's id to get_change_note_impact to see what Search Console did after it. Uses no credits.",
    inputSchema: listInputSchema,
    outputSchema: z.looseObject({
      notes: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof listInputSchema>>, context) => {
      const notes = await ProjectChangeNoteService.listNotes(args.projectId);
      return mcpResponse({
        text:
          notes.length > 0
            ? formatMcpTable(notes, [
                { header: "date", value: (note) => note.noteDate },
                { header: "change", value: (note) => note.label },
                { header: "by", value: (note) => note.createdBy },
                { header: "id", value: (note) => note.id },
              ])
            : "No change notes yet.",
        meta: buildProjectMeta(
          context,
          args.projectId,
          changesPath(args.projectId),
        ),
        structuredContent: { notes },
      });
    },
  ),
};
