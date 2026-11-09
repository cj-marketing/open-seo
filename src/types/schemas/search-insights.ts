import { z } from "zod";
import { searchPerformanceInputSchema } from "@/types/schemas/search-performance";

const SEARCH_INSIGHT_DECAY_DIMENSIONS = ["page", "query"] as const;

/** Same filters and range as the Search Performance report, plus what to compare. */
export const decayInputSchema = searchPerformanceInputSchema.extend({
  dimension: z.enum(SEARCH_INSIGHT_DECAY_DIMENSIONS).default("page"),
});

export const cannibalizationInputSchema = searchPerformanceInputSchema;
