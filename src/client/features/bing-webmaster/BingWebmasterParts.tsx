import { Link } from "@tanstack/react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonTableRows } from "@/client/components/SkeletonPresets";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { formatCount } from "@/client/features/search-performance/SearchPerformanceColumns";
import type { getBingCrawl } from "@/serverFunctions/bingWebmaster";

type BingCrawl = Extract<
  Awaited<ReturnType<typeof getBingCrawl>>,
  { status: "ok" }
>["crawl"];

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

/** The Crawl tab body: latest crawl day, 30-day status breakdown and crawl issues. */
function BingCrawlHealth({ crawl }: { crawl: BingCrawl }) {
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
    <div className="space-y-5 p-4">
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

/** The Crawl tab body: loading, error with retry, or the crawl health. */
export function BingCrawlTab({
  crawlQuery,
}: {
  crawlQuery: UseQueryResult<BingCrawl | null>;
}) {
  if (crawlQuery.data) return <BingCrawlHealth crawl={crawlQuery.data} />;
  // null: the report already handled the unavailable states for this project.
  if (crawlQuery.data === null) return null;
  if (crawlQuery.isError) {
    return (
      <div className="p-4">
        <QueryError
          error={crawlQuery.error}
          fallback="Failed to load Bing data"
          onRetry={() => void crawlQuery.refetch()}
          isRetrying={crawlQuery.isFetching}
        />
      </div>
    );
  }
  return <SkeletonTableRows className="p-4" />;
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
