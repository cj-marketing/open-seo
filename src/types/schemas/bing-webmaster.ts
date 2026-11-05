import { z } from "zod";

export const BING_DAYS = [7, 28, 90, 180] as const;
export type BingDays = (typeof BING_DAYS)[number];
export const BING_DEFAULT_DAYS = 28;

const BING_TABLE_DIMENSIONS = ["query", "page"] as const;

export const bingOverviewInputSchema = z.object({
  projectId: z.string().min(1),
  days: z.union([z.literal(7), z.literal(28), z.literal(90), z.literal(180)]),
});

export const bingTableInputSchema = z.object({
  projectId: z.string().min(1),
  dimension: z.enum(BING_TABLE_DIMENSIONS),
  limit: z.number().int().positive().max(1000),
});

/** /p/$projectId/bing query params. */
export const bingSearchSchema = z.object({
  days: z.coerce
    .number()
    .refine((value) => (BING_DAYS as readonly number[]).includes(value))
    .optional()
    .catch(undefined),
  tab: z.enum(["queries", "pages"]).optional().catch(undefined),
});

export type BingSearch = z.infer<typeof bingSearchSchema>;
