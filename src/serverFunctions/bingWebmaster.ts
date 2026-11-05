import { createServerFn } from "@tanstack/react-start";
import { BingWebmasterService } from "@/server/features/bing-webmaster/services/BingWebmasterService";
import { asAppError } from "@/server/lib/errors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  bingOverviewInputSchema,
  bingTableInputSchema,
} from "@/types/schemas/bing-webmaster";

const CRAWL_ISSUE_LIMIT = 50;

type ServiceFailure = Extract<
  Awaited<ReturnType<typeof BingWebmasterService.getTrafficTrend>>,
  { ok: false }
>;

/** The expected "Bing can't answer for this project" cases, as UI statuses. */
function toFailureStatus(failure: ServiceFailure) {
  switch (failure.reason) {
    case "bing_not_configured":
      return { status: "not_configured" as const };
    case "bing_domain_missing":
      return { status: "domain_missing" as const };
    case "bing_site_not_found":
      return { status: "site_not_found" as const, sites: failure.sites };
  }
}

/** Upstream failures (bad key, rate limit, Bing down) render as an error card;
 *  anything else is a real fault and propagates. */
function toErrorStatus(error: unknown) {
  const appError = asAppError(error);
  if (!appError) throw error;
  return { status: "error" as const, code: appError.code };
}

/**
 * Daily traffic trend and crawl health in one call. Both come from the
 * deployment-wide Bing key and cost no credits.
 */
export const getBingOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingOverviewInputSchema)
  .handler(async ({ data, context }) => {
    const domain = context.project.domain;
    try {
      const [trend, crawl] = await Promise.all([
        BingWebmasterService.getTrafficTrend(domain, { days: data.days }),
        BingWebmasterService.getCrawlHealth(domain, {
          issueLimit: CRAWL_ISSUE_LIMIT,
        }),
      ]);
      if (!trend.ok) return toFailureStatus(trend);
      if (!crawl.ok) return toFailureStatus(crawl);
      return { status: "ok" as const, trend, crawl };
    } catch (error) {
      return toErrorStatus(error);
    }
  });

/** Top queries or pages, summed over the weeks Bing reports. */
export const getBingTable = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(bingTableInputSchema)
  .handler(async ({ data, context }) => {
    try {
      const result = await BingWebmasterService.getSearchPerformance(
        context.project.domain,
        { dimension: data.dimension, limit: data.limit },
      );
      if (!result.ok) return toFailureStatus(result);
      return { status: "ok" as const, ...result };
    } catch (error) {
      return toErrorStatus(error);
    }
  });
