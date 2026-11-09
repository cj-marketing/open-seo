import { sort } from "remeda";
import type { GscSearchAnalyticsRow } from "@/server/lib/gscClient";

/**
 * Pure shaping helpers for the derived Search Console views: a period
 * comparison (content decay, change-note before/after) and keyword
 * cannibalization. Kept separate from the services so the rules are unit
 * testable without a GSC client.
 */

type PeriodDelta = {
  key: string;
  beforeClicks: number;
  afterClicks: number;
  clicksDelta: number;
  beforeImpressions: number;
  afterImpressions: number;
  impressionsDelta: number;
  /** Null when the key had no impressions in that period. */
  beforePosition: number | null;
  afterPosition: number | null;
};

type Metrics = { clicks: number; impressions: number; position: number };

function indexByFirstKey(rows: GscSearchAnalyticsRow[]) {
  const byKey = new Map<string, Metrics>();
  for (const row of rows) {
    const key = row.keys?.[0];
    if (!key) continue;
    byKey.set(key, {
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    });
  }
  return byKey;
}

/** Compare two single-dimension row sets key by key. A key missing from one
 *  side counts as zero there, so keys that vanished or just appeared show up. */
function comparePeriods(
  beforeRows: GscSearchAnalyticsRow[],
  afterRows: GscSearchAnalyticsRow[],
): PeriodDelta[] {
  const before = indexByFirstKey(beforeRows);
  const after = indexByFirstKey(afterRows);
  const deltas: PeriodDelta[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key);
    const a = after.get(key);
    const beforeClicks = b?.clicks ?? 0;
    const afterClicks = a?.clicks ?? 0;
    const beforeImpressions = b?.impressions ?? 0;
    const afterImpressions = a?.impressions ?? 0;
    deltas.push({
      key,
      beforeClicks,
      afterClicks,
      clicksDelta: afterClicks - beforeClicks,
      beforeImpressions,
      afterImpressions,
      impressionsDelta: afterImpressions - beforeImpressions,
      beforePosition: b && b.impressions > 0 ? b.position : null,
      afterPosition: a && a.impressions > 0 ? a.position : null,
    });
  }
  return deltas;
}

// Clicks first, then impressions: a low-click site has many keys tied on
// clicks, and impressions are the earlier signal of a decline.
function isLoss(delta: PeriodDelta): boolean {
  return (
    delta.clicksDelta < 0 ||
    (delta.clicksDelta === 0 && delta.impressionsDelta < 0)
  );
}

function isGain(delta: PeriodDelta): boolean {
  return (
    delta.clicksDelta > 0 ||
    (delta.clicksDelta === 0 && delta.impressionsDelta > 0)
  );
}

function byLoss(a: PeriodDelta, b: PeriodDelta): number {
  return (
    a.clicksDelta - b.clicksDelta || a.impressionsDelta - b.impressionsDelta
  );
}

const DECAY_MIN_IMPRESSIONS_BEFORE = 50;
const INSIGHT_ROW_LIMIT = 100;

/** Keys that ranked for at least 50 impressions in the earlier period and lost
 *  clicks or impressions since, biggest loss first (clicks, then impressions). */
export function buildDecayRows(
  previousRows: GscSearchAnalyticsRow[],
  currentRows: GscSearchAnalyticsRow[],
  limit: number = INSIGHT_ROW_LIMIT,
): PeriodDelta[] {
  return sort(
    comparePeriods(previousRows, currentRows).filter(
      (delta) =>
        delta.beforeImpressions >= DECAY_MIN_IMPRESSIONS_BEFORE &&
        isLoss(delta),
    ),
    byLoss,
  ).slice(0, limit);
}

/** The biggest winners and losers between two periods, for a change note. */
export function topGainsAndLosses(
  beforeRows: GscSearchAnalyticsRow[],
  afterRows: GscSearchAnalyticsRow[],
  limit: number,
): { gains: PeriodDelta[]; losses: PeriodDelta[] } {
  const deltas = comparePeriods(beforeRows, afterRows);
  return {
    gains: sort(deltas.filter(isGain), (a, b) => byLoss(b, a)).slice(0, limit),
    losses: sort(deltas.filter(isLoss), byLoss).slice(0, limit),
  };
}

const CANNIBALIZATION_MIN_SHARE = 0.1;
const CANNIBALIZATION_MIN_PAGE_IMPRESSIONS = 10;

type CannibalizedPage = {
  page: string;
  clicks: number;
  impressions: number;
  position: number;
  /** 0..1 of the query's impressions across every page. */
  share: number;
};

type CannibalizedQuery = {
  query: string;
  totalClicks: number;
  totalImpressions: number;
  /** Every page that showed for the query, including those under the thresholds. */
  pageCount: number;
  pages: CannibalizedPage[];
};

function stripFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
}

/** Queries where two or more pages each take a real share of the impressions.
 *
 *  `["query","page"]` rows are merged per (query, URL without fragment) first:
 *  GSC lists `/post` and `/post#section` as separate pages, which would
 *  otherwise look like two pages competing with themselves. A page counts when
 *  it has at least 10 impressions and 10 % of the query's impressions. */
export function buildCannibalizationRows(
  rows: GscSearchAnalyticsRow[],
  limit: number = INSIGHT_ROW_LIMIT,
): CannibalizedQuery[] {
  type PageStats = { clicks: number; impressions: number; weighted: number };
  const merged = new Map<string, Map<string, PageStats>>();
  for (const row of rows) {
    const query = row.keys?.[0];
    const rawPage = row.keys?.[1];
    if (!query || !rawPage) continue;
    const page = stripFragment(rawPage);
    const pages = merged.get(query) ?? new Map<string, PageStats>();
    const stats = pages.get(page) ?? { clicks: 0, impressions: 0, weighted: 0 };
    stats.clicks += row.clicks;
    stats.impressions += row.impressions;
    stats.weighted += row.position * row.impressions;
    pages.set(page, stats);
    merged.set(query, pages);
  }

  const result: CannibalizedQuery[] = [];
  for (const [query, pages] of merged) {
    let totalClicks = 0;
    let totalImpressions = 0;
    for (const page of pages.values()) {
      totalClicks += page.clicks;
      totalImpressions += page.impressions;
    }
    const competing: CannibalizedPage[] = [];
    for (const [page, stats] of pages) {
      const share =
        totalImpressions > 0 ? stats.impressions / totalImpressions : 0;
      if (
        stats.impressions < CANNIBALIZATION_MIN_PAGE_IMPRESSIONS ||
        share < CANNIBALIZATION_MIN_SHARE
      ) {
        continue;
      }
      competing.push({
        page,
        clicks: stats.clicks,
        impressions: stats.impressions,
        position:
          stats.impressions > 0 ? stats.weighted / stats.impressions : 0,
        share,
      });
    }
    if (competing.length < 2) continue;
    result.push({
      query,
      totalClicks,
      totalImpressions,
      pageCount: pages.size,
      pages: sort(competing, (a, b) => b.impressions - a.impressions),
    });
  }
  return sort(result, (a, b) => b.totalImpressions - a.totalImpressions).slice(
    0,
    limit,
  );
}
