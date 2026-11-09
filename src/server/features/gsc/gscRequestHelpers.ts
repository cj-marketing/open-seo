import {
  GscNotConnectedError,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import type { GscPerformanceFilter } from "@/server/features/gsc/searchAnalytics";
import type { SearchPerformanceType } from "@/types/schemas/search-performance";

/** Build GSC filter groups shared by every call. Device, page, and query apply everywhere;
 *  country applies everywhere except the country breakdown itself (so the
 *  dropdown keeps every option visible while one country is selected). */
export function buildGscFilters(data: {
  searchType: SearchPerformanceType;
  device?: string;
  country?: string;
  pageFilter?: { operator: "contains" | "equals"; expression: string };
  queryFilter?: { operator: "contains" | "equals"; expression: string };
}): {
  nonCountryFilters: GscPerformanceFilter[];
  filters: GscPerformanceFilter[];
} {
  const nonCountryFilters: GscPerformanceFilter[] = data.device
    ? [{ dimension: "device", operator: "equals", expression: data.device }]
    : [];
  if (data.pageFilter)
    nonCountryFilters.push({ dimension: "page", ...data.pageFilter });
  // Discover and Google News have no query dimension to filter on.
  if (data.queryFilter && data.searchType === "web")
    nonCountryFilters.push({ dimension: "query", ...data.queryFilter });
  const filters: GscPerformanceFilter[] = data.country
    ? [
        ...nonCountryFilters,
        { dimension: "country", operator: "equals", expression: data.country },
      ]
    : nonCountryFilters;
  return { nonCountryFilters, filters };
}

/** Not connected, or a dead/denied grant (token failure or 401/403): the page
 *  renders the connect card. Other statuses (429, 5xx) are real faults. */
export function isExpectedConnectionFailure(error: unknown): boolean {
  return error instanceof GscNotConnectedError || isExpectedGrantFailure(error);
}
