import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryState } from "@/client/components/QueryState";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { HttpStatusBadge, SeverityBadge } from "@/client/features/audit/shared";
import {
  getAuditCompareIssues,
  getAuditComparePages,
} from "@/serverFunctions/audit-insights";
import { getIssueDescriptor } from "@/shared/audit-issues";
import { COMPARE_DEFAULT_PAGE_SIZE } from "@/types/schemas/audit-compare";

export type CompareListKind =
  | "new"
  | "fixed"
  | "onNewPage"
  | "onRemovedPage"
  | "added"
  | "removed"
  | "changed";

type IssueKind = "new" | "fixed" | "onNewPage" | "onRemovedPage";
type Pair = { projectId: string; baseAuditId: string; targetAuditId: string };

const LIST_KINDS: { kind: CompareListKind; label: string }[] = [
  { kind: "new", label: "New issues" },
  { kind: "fixed", label: "Fixed issues" },
  { kind: "onNewPage", label: "Issues on new pages" },
  { kind: "onRemovedPage", label: "Issues on removed pages" },
  { kind: "added", label: "Pages added" },
  { kind: "removed", label: "Pages removed" },
  { kind: "changed", label: "Pages changed" },
];

export function isIssueKind(kind: CompareListKind): kind is IssueKind {
  return (
    kind === "new" ||
    kind === "fixed" ||
    kind === "onNewPage" ||
    kind === "onRemovedPage"
  );
}

export function CompareListPicker({
  kind,
  counts,
  onChange,
}: {
  kind: CompareListKind;
  counts: Record<CompareListKind, number>;
  onChange: (kind: CompareListKind) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {LIST_KINDS.map((item) => (
        <Button
          key={item.kind}
          size="sm"
          variant={item.kind === kind ? "default" : "outline"}
          onClick={() => onChange(item.kind)}
        >
          {item.label} ({counts[item.kind].toLocaleString()})
        </Button>
      ))}
    </div>
  );
}

export function CompareList({
  pair,
  kind,
  issueType,
}: {
  pair: Pair;
  kind: CompareListKind;
  issueType?: string;
}) {
  const [page, setPage] = useState(1);
  return isIssueKind(kind) ? (
    <IssueList
      pair={pair}
      issueClass={kind}
      issueType={issueType}
      page={page}
      onPageChange={setPage}
    />
  ) : (
    <PageList pair={pair} kind={kind} page={page} onPageChange={setPage} />
  );
}

function IssueList({
  pair,
  issueClass,
  issueType,
  page,
  onPageChange,
}: {
  pair: Pair;
  issueClass: IssueKind;
  issueType?: string;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const query = useQuery({
    queryKey: ["audit-compare-issues", pair, issueClass, issueType, page],
    queryFn: () =>
      getAuditCompareIssues({
        data: { ...pair, issueClass, issueType, page },
      }),
    placeholderData: (previous) => previous,
  });
  return (
    <QueryState query={query} errorFallback="Failed to load the issues">
      {(data) => (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issue</TableHead>
                <TableHead>Page</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow
                  key={`${row.issueType}|${row.pageUrl}|${row.linkTarget ?? ""}`}
                >
                  <TableCell className="whitespace-nowrap">
                    <SeverityBadge severity={row.severity}>
                      {getIssueDescriptor(row.issueType)?.title ??
                        row.issueType}
                    </SeverityBadge>
                  </TableCell>
                  <TableCell className="max-w-[480px] truncate">
                    <span title={row.pageUrl}>{row.pageUrl}</span>
                    {row.linkTarget ? (
                      <span className="block text-xs text-muted-foreground">
                        Links to {row.linkTarget}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {data.rows.length === 0 ? <EmptyRow colSpan={2} /> : null}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            pageSize={COMPARE_DEFAULT_PAGE_SIZE}
            totalCount={data.totalCount}
            isLoading={query.isFetching}
            onPageChange={onPageChange}
          />
        </TableCard>
      )}
    </QueryState>
  );
}

function PageList({
  pair,
  kind,
  page,
  onPageChange,
}: {
  pair: Pair;
  kind: "added" | "removed" | "changed";
  page: number;
  onPageChange: (page: number) => void;
}) {
  const query = useQuery({
    queryKey: ["audit-compare-pages", pair, kind, page],
    queryFn: () => getAuditComparePages({ data: { ...pair, kind, page } }),
    placeholderData: (previous) => previous,
  });
  return (
    <QueryState query={query} errorFallback="Failed to load the pages">
      {(data) => (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Title</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.url}>
                  <TableCell className="max-w-[360px] truncate">
                    <span title={row.url}>{row.url}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {kind === "changed" &&
                    row.baseStatusCode !== row.statusCode ? (
                      <span className="flex items-center gap-1">
                        <HttpStatusBadge code={row.baseStatusCode} />
                        <span aria-hidden>→</span>
                        <HttpStatusBadge code={row.statusCode} />
                      </span>
                    ) : (
                      <HttpStatusBadge code={row.statusCode} />
                    )}
                  </TableCell>
                  <TableCell className="max-w-[360px] text-xs">
                    {kind === "changed" && row.baseTitle !== row.title ? (
                      <>
                        <span className="block truncate text-muted-foreground line-through">
                          {row.baseTitle || "(no title)"}
                        </span>
                        <span className="block truncate">
                          {row.title || "(no title)"}
                        </span>
                      </>
                    ) : (
                      <span className="block truncate">{row.title}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data.rows.length === 0 ? <EmptyRow colSpan={3} /> : null}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            pageSize={COMPARE_DEFAULT_PAGE_SIZE}
            totalCount={data.totalCount}
            isLoading={query.isFetching}
            onPageChange={onPageChange}
          />
        </TableCard>
      )}
    </QueryState>
  );
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className="py-6 text-center text-muted-foreground"
      >
        Nothing here.
      </TableCell>
    </TableRow>
  );
}
