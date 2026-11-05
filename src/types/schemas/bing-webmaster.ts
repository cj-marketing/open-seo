import { z } from "zod";
import {
  searchPerformanceInputSchema,
  searchPerformanceSearchSchema,
  searchPerformanceTableExportInputSchema,
  searchPerformanceTableInputSchema,
} from "@/types/schemas/search-performance";

// Bing has no search type, device, or country, so the Search Console schemas
// minus those fields are exactly the Bing Performance inputs.
const gscOnlyFields = {
  searchType: true,
  device: true,
  country: true,
} as const;

export const bingReportInputSchema =
  searchPerformanceInputSchema.omit(gscOnlyFields);
export const bingTableInputSchema =
  searchPerformanceTableInputSchema.omit(gscOnlyFields);
export const bingTableExportInputSchema =
  searchPerformanceTableExportInputSchema.omit(gscOnlyFields);
export const bingCrawlInputSchema = z.object({ projectId: z.string().min(1) });

export const BING_TABS = ["striking", "queries", "pages", "crawl"] as const;

/** /p/$projectId/bing query params: the Search Console ones minus type, device and country. */
export const bingSearchSchema = searchPerformanceSearchSchema
  .omit({ tab: true, type: true, device: true, country: true })
  .extend({ tab: z.enum(BING_TABS).optional().catch(undefined) });

export type BingSearch = z.infer<typeof bingSearchSchema>;
