import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import {
  formatCount,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { safeHttpUrl } from "@/shared/safe-url";
import type {
  getSearchCannibalization,
  getSearchDecay,
} from "@/serverFunctions/searchInsights";

type DecayRow = Extract<
  Awaited<ReturnType<typeof getSearchDecay>>,
  { connected: true }
>["rows"][number];
type CannibalizationRow = Extract<
  Awaited<ReturnType<typeof getSearchCannibalization>>,
  { connected: true }
>["rows"][number];

const rightAligned = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums",
} as const;

function PageLink({ url }: { url: string }) {
  return (
    <a
      href={safeHttpUrl(url) ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="block max-w-md truncate text-primary underline-offset-4 hover:underline"
      title={url}
    >
      {url}
    </a>
  );
}

function change(delta: number): string {
  return `${delta > 0 ? "+" : ""}${formatCount(delta)}`;
}

function positionRange(before: number | null, after: number | null): string {
  const text = (value: number | null) =>
    value === null ? "–" : formatPosition(value);
  return `${text(before)} to ${text(after)}`;
}

const decayHelper = createColumnHelper<DecayRow>();

/** Previous period against the selected one. Sorting by a change column
 *  re-sorts within the rows the server returned. */
export function buildDecayColumns(
  keyLabel: "Page" | "Query",
): ColumnDef<DecayRow>[] {
  return [
    decayHelper.accessor("key", {
      enableSorting: false,
      header: () => keyLabel,
      cell: ({ getValue }) =>
        keyLabel === "Page" ? (
          <PageLink url={getValue()} />
        ) : (
          <span className="block max-w-md truncate" title={getValue()}>
            {getValue()}
          </span>
        ),
    }),
    decayHelper.accessor("clicksDelta", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Clicks" align="right" />
      ),
      cell: ({ row }) => (
        <>
          {formatCount(row.original.beforeClicks)} to{" "}
          {formatCount(row.original.afterClicks)}{" "}
          <span className="text-muted-foreground">
            ({change(row.original.clicksDelta)})
          </span>
        </>
      ),
      meta: rightAligned,
    }),
    decayHelper.accessor("impressionsDelta", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Impressions" align="right" />
      ),
      cell: ({ row }) => (
        <>
          {formatCount(row.original.beforeImpressions)} to{" "}
          {formatCount(row.original.afterImpressions)}{" "}
          <span className="text-muted-foreground">
            ({change(row.original.impressionsDelta)})
          </span>
        </>
      ),
      meta: rightAligned,
    }),
    decayHelper.display({
      id: "position",
      header: () => "Position",
      cell: ({ row }) =>
        positionRange(row.original.beforePosition, row.original.afterPosition),
      meta: rightAligned,
    }),
  ];
}

const cannibalizationHelper = createColumnHelper<CannibalizationRow>();

export function buildCannibalizationColumns(): ColumnDef<CannibalizationRow>[] {
  return [
    cannibalizationHelper.accessor("query", {
      enableSorting: false,
      header: () => "Query",
      cell: ({ getValue }) => (
        <span className="block max-w-xs truncate" title={getValue()}>
          {getValue()}
        </span>
      ),
    }),
    cannibalizationHelper.accessor("totalImpressions", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Impressions" align="right" />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: rightAligned,
    }),
    cannibalizationHelper.accessor("totalClicks", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Clicks" align="right" />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: rightAligned,
    }),
    cannibalizationHelper.display({
      id: "pages",
      header: () => "Competing pages (position, impressions, clicks)",
      cell: ({ row }) => (
        <ul className="space-y-1">
          {row.original.pages.map((page) => (
            <li key={page.page} className="flex items-baseline gap-3">
              <PageLink url={page.page} />
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatPosition(page.position)}, {formatCount(page.impressions)}
                , {formatCount(page.clicks)}
              </span>
            </li>
          ))}
        </ul>
      ),
    }),
  ];
}
