import type { ColumnDef } from "@tanstack/react-table";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import type {
  RankTrackingCompetitorDeviceResult,
  RankTrackingRow,
} from "@/types/schemas/rank-tracking";

/** The notice above the table while competitors are shown. */
export function CompetitorNote({ domains }: { domains: string[] }) {
  return (
    <Alert variant="info">
      <Info />
      <AlertDescription>
        {domains.length === 0
          ? "No competitors to show yet. Add competitor domains to the project context; their positions are read from the next check on."
          : "Competitor positions are read from the same Google results as yours, at no extra cost. They start with the next check; earlier checks are not backfilled. A dash means no check has read the competitor yet. Not found means it was not in the results the check returned, which does not prove it ranks lower."}
      </AlertDescription>
    </Alert>
  );
}

function CompetitorRankCell({
  result,
}: {
  result: RankTrackingCompetitorDeviceResult;
}) {
  const { position, previousPosition, checkedAt, rankingUrl } = result;
  if (checkedAt === null) {
    return (
      <span
        className="text-muted-foreground"
        title="No check has read this competitor yet"
      >
        -
      </span>
    );
  }
  if (position === null) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="Not in the results the check returned"
      >
        not found
      </span>
    );
  }
  const change = previousPosition === null ? 0 : previousPosition - position;
  let badgeClass = "";
  if (change > 0) badgeClass = "font-semibold bg-success/20 text-success";
  if (change < 0) badgeClass = "font-semibold bg-warning/20 text-warning";
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={rankingUrl ?? undefined}
    >
      {previousPosition !== null && change !== 0 && (
        <>
          <span className="w-6 text-right font-mono text-xs text-muted-foreground">
            {previousPosition}
          </span>
          <span className="text-muted-foreground/60">→</span>
        </>
      )}
      <span className={`font-mono rounded px-1.5 py-0.5 text-xs ${badgeClass}`}>
        {position}
      </span>
    </span>
  );
}

/** One competitor's position for the device the table is showing. */
export function makeCompetitorColumn(
  domain: string,
  device: "desktop" | "mobile",
): ColumnDef<RankTrackingRow> {
  return {
    id: `competitor:${domain}`,
    enableSorting: false,
    header: () => (
      <span
        className="block max-w-32 cursor-help truncate text-xs font-medium tracking-wide text-muted-foreground"
        title={`Where ${domain} ranks for this keyword`}
      >
        {domain}
      </span>
    ),
    size: 120,
    cell: ({ row }) => {
      const result = row.original.competitors?.find(
        (competitor) => competitor.domain === domain,
      )?.[device];
      return result ? <CompetitorRankCell result={result} /> : null;
    },
  };
}
