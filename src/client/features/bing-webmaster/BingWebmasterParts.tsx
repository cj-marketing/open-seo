import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Area, AreaChart } from "recharts";
import { EmptyState } from "@/client/components/EmptyState";
import {
  ChartGrid,
  ChartXAxis,
  ChartYAxis,
} from "@/client/components/ChartAxes";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { numericNullsLast } from "@/client/components/table/nullSafeSort";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { TablePagination } from "@/client/components/table/TablePagination";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
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
import type {
  getBingOverview,
  getBingTable,
} from "@/serverFunctions/bingWebmaster";

type BingOverview = Extract<
  Awaited<ReturnType<typeof getBingOverview>>,
  { status: "ok" }
>;
type BingTableResult = Extract<
  Awaited<ReturnType<typeof getBingTable>>,
  { status: "ok" }
>;
type BingRow = BingTableResult["rows"][number];

const TABLE_PAGE_SIZE = 25;

export function BingTotals({
  totals,
}: {
  totals: BingOverview["trend"]["totals"];
}) {
  const metrics = [
    { label: "Impressions", value: formatCount(totals.impressions) },
    { label: "Clicks", value: formatCount(totals.clicks) },
    { label: "Click-through rate", value: formatCtr(totals.ctr) },
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-full">Metric</TableHead>
            <TableHead className="min-w-32 text-right">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {metrics.map(({ label, value }) => (
            <TableRow key={label}>
              <TableCell>{label}</TableCell>
              <TableCell className="text-right tabular-nums">{value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const trafficChartConfig = {
  impressions: { label: "Impressions" },
  clicks: { label: "Clicks" },
} satisfies ChartConfig;

function formatDay(date: string): string {
  // Local-time construction: Date.parse("2026-08-01") is UTC midnight and
  // would render as the previous day west of Greenwich.
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Impressions on the left axis, clicks on the right: their scales differ by orders of magnitude. */
export function BingTrafficChart({
  rows,
}: {
  rows: BingOverview["trend"]["rows"];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <ChartContainer config={trafficChartConfig} className="h-64 w-full">
        <AreaChart
          data={rows}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        >
          <ChartGrid />
          <ChartXAxis dataKey="date" tickFormatter={formatDay} />
          <ChartYAxis
            yAxisId="impressions"
            domain={[0, "auto"]}
            tickFormatter={formatCount}
          />
          <ChartYAxis
            yAxisId="clicks"
            orientation="right"
            domain={[0, "auto"]}
            tickFormatter={formatCount}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label: unknown) =>
                  typeof label === "string" ? formatDay(label) : ""
                }
                valueFormatter={(value) => formatCount(Number(value))}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Area
            yAxisId="impressions"
            type="monotone"
            dataKey="impressions"
            stroke="var(--color-impressions)"
            fill="var(--color-impressions)"
            fillOpacity={0.08}
            strokeWidth={2}
          />
          <Area
            yAxisId="clicks"
            type="monotone"
            dataKey="clicks"
            stroke="var(--color-clicks)"
            fill="var(--color-clicks)"
            fillOpacity={0.08}
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

const columnHelper = createColumnHelper<BingRow>();
const rightAligned = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums",
} as const;

function buildColumns(keyLabel: string) {
  return [
    columnHelper.accessor("key", {
      enableSorting: false,
      header: () => keyLabel,
      cell: ({ getValue }) => (
        <span className="block max-w-xl truncate" title={getValue()}>
          {getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("clicks", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Clicks" align="right" />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: rightAligned,
    }),
    columnHelper.accessor("impressions", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Impressions" align="right" />
      ),
      cell: ({ getValue }) => formatCount(getValue()),
      meta: rightAligned,
    }),
    columnHelper.accessor("ctr", {
      header: ({ column }) => (
        <SortableHeader column={column} label="CTR" align="right" />
      ),
      cell: ({ getValue }) => formatCtr(getValue()),
      meta: rightAligned,
    }),
    columnHelper.accessor("avgImpressionPosition", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Avg. position" align="right" />
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "–" : formatPosition(value);
      },
      sortingFn: numericNullsLast,
      meta: rightAligned,
    }),
    columnHelper.accessor("weeks", {
      header: ({ column }) => (
        <SortableHeader column={column} label="Weeks" align="right" />
      ),
      meta: rightAligned,
    }),
  ];
}

/** Sorts and pages the fetched rows in the browser; Bing returns them all at once. */
export function BingDimensionTable({
  keyLabel,
  rows,
}: {
  keyLabel: string;
  rows: BingRow[];
}) {
  const columns = useMemo(() => buildColumns(keyLabel), [keyLabel]);
  const table = useDataTable({
    data: rows,
    columns,
    withSorting: true,
    withPagination: true,
    initialState: {
      sorting: [{ id: "clicks", desc: true }],
      pagination: { pageIndex: 0, pageSize: TABLE_PAGE_SIZE },
    },
  });
  return (
    <DataTable
      table={table}
      empty={{
        title: "No Bing data yet",
        description:
          "Bing can take a few weeks to report data for a new or low-traffic site.",
      }}
      footer={
        rows.length > TABLE_PAGE_SIZE ? (
          <TablePagination
            page={table.getState().pagination.pageIndex + 1}
            pageSize={TABLE_PAGE_SIZE}
            totalCount={rows.length}
            onPageChange={(page) => table.setPageIndex(page - 1)}
          />
        ) : undefined
      }
    />
  );
}

function CrawlStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">
        {formatCount(value)}
      </div>
    </div>
  );
}

export function BingCrawlHealth({ crawl }: { crawl: BingOverview["crawl"] }) {
  const { latest, last30Days, issues, issueCount } = crawl;
  const statuses = [
    { label: "2xx", value: last30Days.code2xx },
    { label: "301", value: last30Days.code301 },
    { label: "302", value: last30Days.code302 },
    { label: "4xx", value: last30Days.code4xx },
    { label: "5xx", value: last30Days.code5xx },
    { label: "Other", value: last30Days.allOtherCodes },
    { label: "Blocked by robots.txt", value: last30Days.blockedByRobotsTxt },
  ];
  return (
    <div className="space-y-5 rounded-xl border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">Crawl health</h2>
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          {latest ? `Latest day (${latest.date})` : "Latest day"}
        </h3>
        {latest ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <CrawlStat label="In index" value={latest.inIndex} />
            <CrawlStat label="Crawled pages" value={latest.crawledPages} />
            <CrawlStat label="Crawl errors" value={latest.crawlErrors} />
            <CrawlStat label="Inbound links" value={latest.inLinks} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Bing has not reported crawl stats yet.
          </p>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Crawled pages by status, last {last30Days.days} days
        </h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {statuses.map((status) => (
            <CrawlStat key={status.label} {...status} />
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Crawl issues
          {issueCount > issues.length
            ? ` (top ${issues.length} of ${formatCount(issueCount)} by inbound links)`
            : ""}
        </h3>
        {issues.length === 0 ? (
          <p className="text-sm">No crawl issues reported.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Issues</TableHead>
                <TableHead className="text-right">Inbound links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((issue) => (
                <TableRow key={issue.url}>
                  <TableCell>
                    <span className="block max-w-md truncate" title={issue.url}>
                      {issue.url}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {issue.httpCode}
                  </TableCell>
                  <TableCell>{issue.issues.join(", ")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(issue.inLinks)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

/** The expected "no Bing data for this project" states. */
export function BingUnavailable({
  projectId,
  status,
  sites,
}: {
  projectId: string;
  status: "not_configured" | "domain_missing" | "site_not_found";
  sites?: string[];
}) {
  if (status === "not_configured") {
    return (
      <EmptyState
        variant="card"
        title="Bing Webmaster Tools is not set up"
        description={
          <>
            Set <code>BING_WEBMASTER_API_KEY</code> on this deployment (Bing
            Webmaster Tools → Settings → API access), then restart it. See{" "}
            <code>docs/SELF_HOSTING_BING_WEBMASTER.md</code> for the steps.
          </>
        }
      />
    );
  }
  if (status === "domain_missing") {
    return (
      <EmptyState
        variant="card"
        title="This project has no domain"
        description="Set the project's domain so OpenSEO can match it to a Bing site."
        action={
          <Link
            to="/p/$projectId/settings"
            params={{ projectId }}
            className="text-sm font-medium underline underline-offset-4"
          >
            Open project settings
          </Link>
        }
      />
    );
  }
  return (
    <EmptyState
      variant="card"
      title="This site is not in Bing Webmaster Tools"
      description={
        <>
          Add and verify the site in Bing Webmaster Tools, or import it from
          Google Search Console.{" "}
          {sites && sites.length > 0
            ? `Sites your API key can see: ${sites.join(", ")}.`
            : "Your API key cannot see any sites yet."}
        </>
      }
    />
  );
}
