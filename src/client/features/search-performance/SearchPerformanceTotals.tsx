import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  formatCount,
  formatCtr,
  formatPosition,
  type Report,
} from "@/client/features/search-performance/SearchPerformanceColumns";

type Delta = { text: string; improved: boolean } | null;

function percentDelta(current: number, previous: number): Delta {
  if (previous <= 0) return null;
  const change = (current - previous) / previous;
  const pct = (change * 100).toFixed(1);
  return { text: `${change >= 0 ? "+" : ""}${pct}%`, improved: change >= 0 };
}

/** Position falls as rankings improve, so the delta is inverted. */
function positionDelta(current: number, previous: number): Delta {
  if (previous <= 0 || current <= 0) return null;
  const change = previous - current;
  return {
    text: `${change >= 0 ? "+" : ""}${change.toFixed(1)}`,
    improved: change >= 0,
  };
}

/** Discover and Google News report no position, so it is left out there. */
export function TotalsTable({
  report,
  showPosition,
}: {
  report: Pick<Report, "totals" | "prevTotals" | "range">;
  showPosition: boolean;
}) {
  const { totals, prevTotals, range } = report;
  const deltaTitle = `Compared with ${range.prevStartDate} to ${range.prevEndDate}`;
  const metrics = [
    {
      label: "Clicks",
      value: formatCount(totals.clicks),
      delta: percentDelta(totals.clicks, prevTotals.clicks),
    },
    {
      label: "Impressions",
      value: formatCount(totals.impressions),
      delta: percentDelta(totals.impressions, prevTotals.impressions),
    },
    {
      label: "Click-through rate",
      value: formatCtr(totals.ctr),
      delta: percentDelta(totals.ctr, prevTotals.ctr),
    },
    ...(showPosition
      ? [
          {
            label: "Average position",
            value: formatPosition(totals.position),
            delta: positionDelta(totals.position, prevTotals.position),
          },
        ]
      : []),
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-full">Metric</TableHead>
            <TableHead className="min-w-32 text-right">Value</TableHead>
            <TableHead className="min-w-32 text-right" title={deltaTitle}>
              Change
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {metrics.map(({ label, value, delta }) => (
            <TableRow key={label}>
              <TableCell>{label}</TableCell>
              <TableCell className="text-right tabular-nums">{value}</TableCell>
              <TableCell
                className={`text-right tabular-nums ${delta ? (delta.improved ? "text-success" : "text-destructive") : "text-muted-foreground"}`}
                title={deltaTitle}
              >
                {delta?.text ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
