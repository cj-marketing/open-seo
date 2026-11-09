import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { loadRankCompetitorDomains } from "@/server/features/rank-tracking/services/rankCompetitors";
import type { RankTrackingCompetitorDeviceResult } from "@/types/schemas/rank-tracking";

const EMPTY_RESULT: RankTrackingCompetitorDeviceResult = {
  position: null,
  previousPosition: null,
  rankingUrl: null,
  checkedAt: null,
};

type CompetitorSnapshot = Awaited<
  ReturnType<typeof RankTrackingRepository.getCompetitorSnapshotsForConfig>
>[number];

function cellKey(
  trackingKeywordId: string,
  device: string,
  domain: string,
): string {
  return `${trackingKeywordId}:${device}:${domain}`;
}

/**
 * Latest and previous competitor positions for a tracker. Previous follows the
 * same rule as our own: the newest read from before the compare date, else the
 * oldest read when it is from an earlier run than the latest. A cell with no
 * row has no data yet (competitor data starts with the first check after the
 * competitor was added); a row with a null position means the domain was not
 * in the results that check returned.
 */
export async function getCompetitorResults(input: {
  configId: string;
  projectId: string;
  trackedDomain: string;
  compareDate: string;
}) {
  const domains = await loadRankCompetitorDomains(
    input.projectId,
    input.trackedDomain,
  );
  const [latest, before, earliest] = await Promise.all(
    (
      [
        { order: "latest" },
        { order: "latest", beforeDate: input.compareDate },
        { order: "earliest" },
      ] as const
    ).map((opts) =>
      RankTrackingRepository.getCompetitorSnapshotsForConfig(input.configId, {
        ...opts,
        domains,
      }),
    ),
  );

  const byCell = <T extends CompetitorSnapshot>(rows: T[]) =>
    new Map(
      rows.map((row) => [
        cellKey(row.trackingKeywordId, row.device, row.domain),
        row,
      ]),
    );
  const beforeByCell = byCell(before);
  const earliestByCell = byCell(earliest);
  const results = new Map<string, RankTrackingCompetitorDeviceResult>();
  for (const row of latest) {
    const key = cellKey(row.trackingKeywordId, row.device, row.domain);
    const oldest = earliestByCell.get(key);
    const previous =
      beforeByCell.get(key) ?? (oldest?.runId !== row.runId ? oldest : null);
    results.set(key, {
      position: row.position,
      previousPosition: previous?.position ?? null,
      rankingUrl: row.url,
      checkedAt: row.checkedAt,
    });
  }

  return {
    domains,
    forCell: (trackingKeywordId: string, device: string, domain: string) =>
      results.get(cellKey(trackingKeywordId, device, domain)) ?? EMPTY_RESULT,
  };
}
