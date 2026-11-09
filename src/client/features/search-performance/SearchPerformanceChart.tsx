import { sort } from "remeda";
import { ReferenceLine } from "recharts";
import type { ChartConfig } from "@/client/components/ui/chart";
import { TrendChart } from "@/client/features/dashboard/DashboardMetrics";
import type { Report } from "@/client/features/search-performance/SearchPerformanceColumns";
import type { listChangeNotes } from "@/serverFunctions/searchInsights";

export type ChangeNote = Awaited<ReturnType<typeof listChangeNotes>>[number];

const chartConfig = {
  clicks: { label: "Clicks", color: "var(--chart-1)" },
  impressions: { label: "Impressions", color: "var(--chart-2)" },
} satisfies ChartConfig;

export type NumberedNote = { note: ChangeNote; number: number };

/** The notes that fall inside the chart's range, oldest first and numbered, so
 *  a marker on the chart and its row in the notes list share a number. */
export function numberNotesInRange(
  notes: ChangeNote[],
  range: { startDate: string; endDate: string },
): NumberedNote[] {
  const inRange = notes.filter(
    (note) =>
      note.noteDate >= range.startDate && note.noteDate <= range.endDate,
  );
  return sort(
    inRange,
    (a, b) => a.noteDate.localeCompare(b.noteDate) || a.id.localeCompare(b.id),
  ).map((note, index) => ({ note, number: index + 1 }));
}

/** Daily clicks and impressions with a dashed marker on each change-note day. */
export function SearchPerformanceChart({
  trend,
  numbered,
}: {
  trend: Report["trend"];
  numbered: NumberedNote[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-1.5 rounded-full bg-chart-1" />
          Clicks
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-1.5 rounded-full bg-chart-2" />
          Impressions
        </span>
        {numbered.length > 0 ? (
          <span>Dashed lines mark change notes</span>
        ) : null}
      </div>
      <div className="flex h-56 flex-col">
        <TrendChart config={chartConfig} data={trend}>
          {numbered.map(({ note, number }) => (
            <ReferenceLine
              key={note.id}
              yAxisId="clicks"
              x={note.noteDate}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 3"
              label={{
                value: String(number),
                position: "top",
                fontSize: 11,
                fill: "var(--foreground)",
              }}
            />
          ))}
        </TrendChart>
      </div>
    </div>
  );
}
