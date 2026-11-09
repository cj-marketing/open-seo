import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChangeNotesPanel } from "@/client/features/search-performance/ChangeNotesPanel";
import type { Report } from "@/client/features/search-performance/SearchPerformanceColumns";
import {
  numberNotesInRange,
  SearchPerformanceChart,
} from "@/client/features/search-performance/SearchPerformanceChart";
import { listChangeNotes } from "@/serverFunctions/searchInsights";

/** The report's daily trend with change-note markers, and the notes beneath it. */
export function SearchPerformanceChartCard({
  projectId,
  report,
}: {
  projectId: string;
  report: Pick<Report, "trend" | "totals" | "range">;
}) {
  const notesQuery = useQuery({
    queryKey: ["changeNotes", projectId],
    queryFn: () => listChangeNotes({ data: { projectId } }),
  });
  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data]);
  const { startDate, endDate } = report.range;
  const numbered = useMemo(
    () => numberNotesInRange(notes, { startDate, endDate }),
    [notes, startDate, endDate],
  );

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      {report.totals.impressions > 0 ? (
        <SearchPerformanceChart trend={report.trend} numbered={numbered} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No search data for this period yet.
        </p>
      )}
      {notesQuery.isError ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t load change notes.
        </p>
      ) : (
        <ChangeNotesPanel
          projectId={projectId}
          notes={notes}
          numbered={numbered}
        />
      )}
    </div>
  );
}
