import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { BackButton } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  CompareList,
  CompareListPicker,
  isIssueKind,
  type CompareListKind,
} from "@/client/features/audit/compare/CompareLists";
import { formatDate, SeverityBadge } from "@/client/features/audit/shared";
import { compareAudits } from "@/serverFunctions/audit-insights";
import { getIssueDescriptor } from "@/shared/audit-issues";

type Props = {
  projectId: string;
  baseAuditId: string;
  targetAuditId: string;
  onClose: () => void;
};

export function CompareView({
  projectId,
  baseAuditId,
  targetAuditId,
  onClose,
}: Props) {
  const query = useQuery({
    queryKey: ["audit-compare", projectId, baseAuditId, targetAuditId],
    queryFn: () =>
      compareAudits({ data: { projectId, baseAuditId, targetAuditId } }),
  });
  const [kind, setKind] = useState<CompareListKind>("new");
  const [issueType, setIssueType] = useState<string | undefined>();

  return (
    <div className="space-y-4">
      <BackButton onClick={onClose}>Back to results</BackButton>
      <QueryState query={query} errorFallback="Failed to compare the audits">
        {(data) => (
          <>
            <p className="text-sm text-muted-foreground">
              Compared with the audit from {formatDate(data.base.startedAt)} (
              {data.base.pageCount.toLocaleString()} pages). This audit crawled{" "}
              {data.target.pageCount.toLocaleString()} pages.
            </p>
            {data.coverageWarning ? (
              <Alert variant="warning">
                <AlertCircle />
                <AlertDescription>{data.coverageWarning}</AlertDescription>
              </Alert>
            ) : null}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="New issues" value={data.totals.new} />
              <Stat label="Fixed issues" value={data.totals.fixed} />
              <Stat label="On new pages" value={data.totals.onNewPage} />
              <Stat
                label="On removed pages"
                value={data.totals.onRemovedPage}
              />
            </div>

            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Issue</TableHead>
                    <TableHead className="text-right">Before</TableHead>
                    <TableHead className="text-right">Now</TableHead>
                    <TableHead className="text-right">New</TableHead>
                    <TableHead className="text-right">Fixed</TableHead>
                    <TableHead className="text-right">On new pages</TableHead>
                    <TableHead className="text-right">
                      On removed pages
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.issueTypes.map((row) => (
                    <TableRow
                      key={row.issueType}
                      className="cursor-pointer"
                      data-state={
                        issueType === row.issueType ? "selected" : undefined
                      }
                      onClick={() =>
                        setIssueType(
                          issueType === row.issueType
                            ? undefined
                            : row.issueType,
                        )
                      }
                    >
                      <TableCell>
                        <SeverityBadge severity={row.severity}>
                          {getIssueDescriptor(row.issueType)?.title ??
                            row.issueType}
                        </SeverityBadge>
                      </TableCell>
                      <NumberCell value={row.base} />
                      <NumberCell value={row.target} />
                      <NumberCell value={row.new} />
                      <NumberCell value={row.fixed} />
                      <NumberCell value={row.onNewPage} />
                      <NumberCell value={row.onRemovedPage} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>

            <CompareListPicker
              kind={kind}
              counts={{
                ...data.pages,
                new: data.totals.new,
                fixed: data.totals.fixed,
                onNewPage: data.totals.onNewPage,
                onRemovedPage: data.totals.onRemovedPage,
              }}
              onChange={setKind}
            />
            {issueType && isIssueKind(kind) ? (
              <p className="text-sm text-muted-foreground">
                Showing {getIssueDescriptor(issueType)?.title ?? issueType}{" "}
                only.{" "}
                <Button
                  variant="link"
                  className="h-auto p-0 text-sm"
                  onClick={() => setIssueType(undefined)}
                >
                  Show all
                </Button>
              </p>
            ) : null}
            <CompareList
              key={`${kind}:${issueType ?? ""}`}
              pair={{ projectId, baseAuditId, targetAuditId }}
              kind={kind}
              issueType={issueType}
            />

            {data.lighthouse.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Lighthouse performance changes</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Page</TableHead>
                        <TableHead>Device</TableHead>
                        <TableHead className="text-right">Before</TableHead>
                        <TableHead className="text-right">Now</TableHead>
                        <TableHead className="text-right">Change</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.lighthouse.map((row) => (
                        <TableRow key={`${row.url}|${row.strategy}`}>
                          <TableCell className="max-w-[360px] truncate">
                            {row.url}
                          </TableCell>
                          <TableCell>{row.strategy}</TableCell>
                          <NumberCell value={row.base.performance} />
                          <NumberCell value={row.target.performance} />
                          <TableCell className="text-right tabular-nums">
                            {row.performanceDelta > 0 ? "+" : ""}
                            {row.performanceDelta}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
      </QueryState>
    </div>
  );
}

function NumberCell({ value }: { value: number | null }) {
  return (
    <TableCell className="text-right tabular-nums">{value ?? "-"}</TableCell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold tabular-nums">
        {value.toLocaleString()}
      </CardContent>
    </Card>
  );
}
