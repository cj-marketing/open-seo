import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Spinner } from "@/client/components/ui/spinner";
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
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { safeHttpUrl } from "@/shared/safe-url";
import { getChangeNoteImpact } from "@/serverFunctions/searchInsights";
import { CHANGE_NOTE_WINDOW_DAYS } from "@/types/schemas/change-notes";

type ImpactResult = Extract<
  Awaited<ReturnType<typeof getChangeNoteImpact>>,
  { connected: true }
>["impact"];
type OkImpact = Extract<ImpactResult, { status: "ok" }>;

const WINDOW_ITEMS = CHANGE_NOTE_WINDOW_DAYS.map((days) => ({
  value: String(days),
  label: `${days} days`,
}));

function signed(value: number, format: (n: number) => string): string {
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${format(Math.abs(value))}`;
}

function MetricsTable({ impact }: { impact: OkImpact }) {
  const { before, after } = impact;
  const rows = [
    {
      label: "Clicks",
      before: formatCount(before.totals.clicks),
      after: formatCount(after.totals.clicks),
      change: signed(after.totals.clicks - before.totals.clicks, formatCount),
    },
    {
      label: "Impressions",
      before: formatCount(before.totals.impressions),
      after: formatCount(after.totals.impressions),
      change: signed(
        after.totals.impressions - before.totals.impressions,
        formatCount,
      ),
    },
    {
      label: "CTR",
      before: formatCtr(before.totals.ctr),
      after: formatCtr(after.totals.ctr),
      change: `${signed((after.totals.ctr - before.totals.ctr) * 100, (n) => n.toFixed(1))} pts`,
    },
    {
      label: "Position",
      before: formatPosition(before.totals.position),
      after: formatPosition(after.totals.position),
      // A lower position number is better; the sign is the raw difference.
      change: signed(
        after.totals.position - before.totals.position,
        formatPosition,
      ),
    },
  ];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead className="text-right">
            Before ({before.startDate} to {before.endDate})
          </TableHead>
          <TableHead className="text-right">
            After ({after.startDate} to {after.endDate})
          </TableHead>
          <TableHead className="text-right">Change</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell className="text-right tabular-nums">
              {row.before}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.after}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.change}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PageDeltaList({
  title,
  rows,
}: {
  title: string;
  rows: OkImpact["topGains"];
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-sm font-medium">{title}</h4>
      <ul className="space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.key} className="flex items-baseline gap-3">
            <a
              href={safeHttpUrl(row.key) ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-primary underline-offset-4 hover:underline"
              title={row.key}
            >
              {row.key}
            </a>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatCount(row.beforeClicks)} to {formatCount(row.afterClicks)}{" "}
              clicks, {formatCount(row.beforeImpressions)} to{" "}
              {formatCount(row.afterImpressions)} impressions
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ImpactBody({ impact }: { impact: ImpactResult }) {
  if (impact.status === "no_after_data") {
    return (
      <p className="text-sm text-muted-foreground">
        No complete Search Console days after this change yet. Data ends{" "}
        {impact.latestDate}; check again in a few days.
      </p>
    );
  }
  if (impact.status === "no_before_data") {
    return (
      <p className="text-sm text-muted-foreground">
        This change is older than the 16 months Search Console keeps, so there
        is no before period to compare.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {impact.comparedDays < impact.windowDays
          ? `${impact.comparedDays} of ${impact.windowDays} days after the change are available so far. They are compared with the ${impact.comparedDays} days before it.`
          : `The ${impact.windowDays} days after the change, compared with the ${impact.windowDays} days before it.`}{" "}
        The change day itself is left out. A difference here does not prove the
        change caused it.
      </p>
      <MetricsTable impact={impact} />
      <PageDeltaList title="Pages that gained most" rows={impact.topGains} />
      <PageDeltaList title="Pages that lost most" rows={impact.topLosses} />
    </div>
  );
}

/** Before/after Search Console numbers for one change note. */
export function ChangeNoteImpact({
  projectId,
  noteId,
}: {
  projectId: string;
  noteId: string;
}) {
  const [windowDays, setWindowDays] = useState<number>(28);
  const [draft, setDraft] = useState("");
  const [pageContains, setPageContains] = useState<string | undefined>();

  const query = useQuery({
    queryKey: ["changeNoteImpact", projectId, noteId, windowDays, pageContains],
    queryFn: () =>
      getChangeNoteImpact({
        data: { projectId, noteId, windowDays, pageContains },
      }),
  });
  const result = query.data;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPageContains(draft.trim() || undefined);
        }}
      >
        <Select
          items={WINDOW_ITEMS}
          value={String(windowDays)}
          onValueChange={(value) => {
            if (value != null) setWindowDays(Number(value));
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-28"
            aria-label="Days to compare"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Only pages containing… (optional)"
          aria-label="Only pages whose URL contains"
          className="h-8 max-w-64 md:text-sm"
        />
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        {query.isFetching ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : null}
      </form>
      {query.isError ? (
        <QueryError
          error={query.error}
          fallback="Failed to load the comparison"
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      ) : result && !result.connected ? (
        <p className="text-sm text-muted-foreground">
          Search Console is not available for this project right now.
        </p>
      ) : result ? (
        <ImpactBody impact={result.impact} />
      ) : null}
    </div>
  );
}
