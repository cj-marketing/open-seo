import { createServerFn } from "@tanstack/react-start";
import { resolveDateRange } from "@/server/features/gsc/searchAnalytics";
import {
  buildGscFilters,
  isExpectedConnectionFailure,
} from "@/server/features/gsc/gscRequestHelpers";
import { ChangeNoteImpactService } from "@/server/features/gsc/services/ChangeNoteImpactService";
import { SearchInsightsService } from "@/server/features/gsc/services/SearchInsightsService";
import { ProjectChangeNoteService } from "@/server/features/project-context/services/ProjectChangeNoteService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  addChangeNoteSchema,
  changeNoteImpactSchema,
  deleteChangeNoteSchema,
  listChangeNotesSchema,
} from "@/types/schemas/change-notes";
import {
  cannibalizationInputSchema,
  decayInputSchema,
} from "@/types/schemas/search-insights";

export const listChangeNotes = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listChangeNotesSchema)
  .handler(async ({ context }) =>
    ProjectChangeNoteService.listNotes(context.projectId),
  );

export const addChangeNote = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(addChangeNoteSchema)
  .handler(async ({ data, context }) =>
    // Everything reaching this entry point is a person on the page; SAM and MCP
    // write through the same service with their own author.
    ProjectChangeNoteService.addNote(
      context.projectId,
      { noteDate: data.noteDate, label: data.label },
      "user",
    ),
  );

export const deleteChangeNote = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(deleteChangeNoteSchema)
  .handler(async ({ data, context }) => {
    await ProjectChangeNoteService.deleteNote(context.projectId, data.noteId);
    return { deleted: true as const };
  });

export const getChangeNoteImpact = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(changeNoteImpactSchema)
  .handler(async ({ data, context }) => {
    try {
      const impact = await ChangeNoteImpactService.getImpact(
        context.projectId,
        data,
      );
      return { connected: true as const, impact };
    } catch (error) {
      if (isExpectedConnectionFailure(error)) {
        return { connected: false as const };
      }
      throw error;
    }
  });

/** Pages or queries that lost clicks or impressions against the period before
 *  the selected one. First-party GSC data, free. */
export const getSearchDecay = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(decayInputSchema)
  .handler(async ({ data, context }) => {
    const range = resolveDateRange({ dateRange: data.dateRange });
    try {
      const result = await SearchInsightsService.getDecay({
        projectId: context.projectId,
        ...range,
        filters: buildGscFilters(data).filters,
        dimension: data.dimension,
      });
      return { connected: true as const, ...result };
    } catch (error) {
      if (isExpectedConnectionFailure(error)) {
        return { connected: false as const };
      }
      throw error;
    }
  });

/** Queries where several of the site's own pages compete. Fetches up to 25,000
 *  query x page rows, so the page asks for it only while the tab is open. */
export const getSearchCannibalization = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(cannibalizationInputSchema)
  .handler(async ({ data, context }) => {
    const range = resolveDateRange({ dateRange: data.dateRange });
    try {
      const result = await SearchInsightsService.getCannibalization({
        projectId: context.projectId,
        ...range,
        filters: buildGscFilters(data).filters,
      });
      return { connected: true as const, ...result };
    } catch (error) {
      if (isExpectedConnectionFailure(error)) {
        return { connected: false as const };
      }
      throw error;
    }
  });
