import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

const BING_API_BASE = "https://ssl.bing.com/webmaster/api.svc/json";
const BING_TIMEOUT_MS = 15_000;

// "/Date(1316156400000-0700)/": the number is UTC epoch ms, the offset is
// optional and informational only.
const bingDateSchema = z.string().transform((value, ctx) => {
  const match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (!match) {
    ctx.addIssue({ code: "custom", message: "Unrecognized Bing date" });
    return z.NEVER;
  }
  return new Date(Number(match[1])).toISOString().slice(0, 10);
});

// Bing sometimes sends null for a count or position it has no value for;
// treat that as 0 rather than rejecting the whole response.
const bingNumber = z
  .number()
  .nullish()
  .transform((value) => value ?? 0);

const userSitesSchema = z.object({
  d: z.array(z.object({ Url: z.string(), IsVerified: z.boolean() })),
});

export const statsRowsSchema = z.object({
  d: z.array(
    z.object({
      Query: z.string(),
      Impressions: bingNumber,
      Clicks: bingNumber,
      AvgImpressionPosition: bingNumber,
      AvgClickPosition: bingNumber,
      Date: bingDateSchema,
    }),
  ),
});

export const trafficSchema = z.object({
  d: z.array(
    z.object({
      Date: bingDateSchema,
      Impressions: bingNumber,
      Clicks: bingNumber,
    }),
  ),
});

export const crawlStatsSchema = z.object({
  d: z.array(
    z.object({
      Date: bingDateSchema,
      CrawledPages: bingNumber,
      CrawlErrors: bingNumber,
      InIndex: bingNumber,
      InLinks: bingNumber,
      Code2xx: bingNumber,
      Code301: bingNumber,
      Code302: bingNumber,
      Code4xx: bingNumber,
      Code5xx: bingNumber,
      AllOtherCodes: bingNumber,
      BlockedByRobotsTxt: bingNumber,
      ContainsMalware: bingNumber,
    }),
  ),
});

export const crawlIssuesSchema = z.object({
  d: z.array(
    z.object({
      Url: z.string(),
      HttpCode: bingNumber,
      Issues: bingNumber,
      InLinks: bingNumber,
    }),
  ),
});

const bingErrorSchema = z.object({
  ErrorCode: z.number().optional(),
  Message: z.string().optional(),
});

type SiteFailure =
  | { ok: false; reason: "bing_not_configured" }
  | { ok: false; reason: "bing_domain_missing" }
  | { ok: false; reason: "bing_site_not_found"; sites: string[] };

function hostOf(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./, "");
}

// The key travels in the query string, so nothing here may log or return the
// URL: only the method name and HTTP status appear in logs and messages.
export async function bingRequest<T>(
  method: string,
  apiKey: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  const url = new URL(`${BING_API_BASE}/${method}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("apikey", apiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(BING_TIMEOUT_MS),
    });
  } catch {
    console.warn(`Bing Webmaster ${method} request failed (network/timeout)`);
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Bing Webmaster ${method} did not respond.`,
    );
  }

  if (!response.ok) {
    const body = bingErrorSchema.safeParse(
      await response.json().catch(() => null),
    );
    const detail = body.success ? body.data : {};
    console.warn(`Bing Webmaster ${method} failed (${response.status})`);
    if (detail.Message === "InvalidApiKey") {
      throw new AppError(
        "VALIDATION_ERROR",
        "Bing rejected BING_WEBMASTER_API_KEY (InvalidApiKey). Create a new key in Bing Webmaster Tools → Settings → API access.",
      );
    }
    const code =
      response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_UNAVAILABLE";
    const suffix = detail.Message ? `: ${detail.Message}` : "";
    throw new AppError(
      code,
      `Bing Webmaster ${method} failed (${response.status})${suffix}.`,
    );
  }

  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    console.warn(`Bing Webmaster ${method} returned an unexpected response`);
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Bing Webmaster ${method} returned an unexpected response.`,
    );
  }
  return parsed.data;
}

export async function withSite<T>(
  domain: string | null,
  run: (siteUrl: string, apiKey: string) => Promise<T>,
): Promise<T | SiteFailure> {
  const apiKey = (await getOptionalEnvValue("BING_WEBMASTER_API_KEY"))?.trim();
  if (!apiKey) return { ok: false, reason: "bing_not_configured" };
  if (!domain) return { ok: false, reason: "bing_domain_missing" };

  const { d: sites } = await bingRequest(
    "GetUserSites",
    apiKey,
    {},
    userSitesSchema,
  );
  const host = hostOf(domain);
  const matches = sites.filter(
    (site) => site.IsVerified && hostOf(site.Url) === host,
  );
  const site =
    matches.find((candidate) => candidate.Url.startsWith("https://")) ??
    matches[0];
  if (!site) {
    return {
      ok: false,
      reason: "bing_site_not_found",
      sites: sites.map((candidate) => candidate.Url),
    };
  }
  return run(site.Url, apiKey);
}
