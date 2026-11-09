import { and, eq, inArray, lte, max, min, sql } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { db } from "@/db";
import { rankCheckRuns, rankCompetitorSnapshots } from "@/db/schema";
import { executeInBatches } from "@/db/runBatch";

type CompetitorSnapshotInsert = Omit<
  InferInsertModel<typeof rankCompetitorSnapshots>,
  "id" | "checkedAt"
>;

/**
 * Save competitor reads, keeping the best position per run/keyword/device/
 * domain, the way our own position is kept across retries: a later read
 * replaces the saved one only when it ranks higher, and a miss never replaces
 * a position. The first read of a pair is saved as it is, miss included.
 */
export async function upsertBestCompetitorSnapshots(
  rows: CompetitorSnapshotInsert[],
) {
  const table = rankCompetitorSnapshots;
  const isBetter = sql`excluded.position IS NOT NULL AND (${table.position} IS NULL OR excluded.position < ${table.position})`;
  await executeInBatches(rows, (tx, row) =>
    tx
      .insert(table)
      .values(row)
      .onConflictDoUpdate({
        target: [
          table.runId,
          table.trackingKeywordId,
          table.device,
          table.domain,
        ],
        set: {
          position: sql`CASE WHEN ${isBetter} THEN excluded.position ELSE ${table.position} END`,
          url: sql`CASE WHEN ${isBetter} THEN excluded.url ELSE ${table.url} END`,
        },
      }),
  );
}

/**
 * One competitor row per keyword, device and domain from completed runs of a
 * config: the newest, or the oldest, optionally no newer than `beforeDate`.
 * Picked in SQL, like the tracker's own snapshots, so history is never loaded.
 */
export async function getCompetitorSnapshotsForConfig(
  configId: string,
  opts: {
    beforeDate?: string;
    order: "latest" | "earliest";
    domains: string[];
  },
) {
  if (opts.domains.length === 0) return [];
  const table = rankCompetitorSnapshots;
  const completedRunIds = db
    .select({ id: rankCheckRuns.id })
    .from(rankCheckRuns)
    .where(
      and(
        eq(rankCheckRuns.configId, configId),
        eq(rankCheckRuns.status, "completed"),
      ),
    );
  const aggFn = opts.order === "latest" ? max : min;
  const conditions = [
    inArray(table.runId, completedRunIds),
    inArray(table.domain, opts.domains),
  ];
  if (opts.beforeDate) conditions.push(lte(table.checkedAt, opts.beforeDate));

  const grouped = db
    .select({
      trackingKeywordId: table.trackingKeywordId,
      device: table.device,
      domain: table.domain,
      targetCheckedAt: aggFn(table.checkedAt).as("target_checked_at"),
    })
    .from(table)
    .where(and(...conditions))
    .groupBy(table.trackingKeywordId, table.device, table.domain)
    .as("grouped");

  return db
    .select({
      runId: table.runId,
      trackingKeywordId: table.trackingKeywordId,
      device: table.device,
      domain: table.domain,
      position: table.position,
      url: table.url,
      checkedAt: table.checkedAt,
    })
    .from(table)
    .innerJoin(
      grouped,
      and(
        eq(table.trackingKeywordId, grouped.trackingKeywordId),
        eq(table.device, grouped.device),
        eq(table.domain, grouped.domain),
        eq(table.checkedAt, grouped.targetCheckedAt),
      ),
    )
    .where(inArray(table.runId, completedRunIds));
}
