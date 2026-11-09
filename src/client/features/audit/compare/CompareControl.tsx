import { useQuery } from "@tanstack/react-query";
import { GitCompare } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { formatDate } from "@/client/features/audit/shared";
import { getAuditHistory } from "@/serverFunctions/audit";

/** Picks an earlier completed audit of the project to compare this one with. */
export function CompareControl({
  projectId,
  auditId,
  onCompare,
}: {
  projectId: string;
  auditId: string;
  onCompare: (baseAuditId: string) => void;
}) {
  const historyQuery = useQuery({
    queryKey: ["audit-history", projectId],
    queryFn: () => getAuditHistory({ data: { projectId } }),
  });
  const history = historyQuery.data ?? [];
  // History is newest first, so earlier audits come after this one.
  const index = history.findIndex((audit) => audit.id === auditId);
  const earlier =
    index < 0
      ? []
      : history
          .slice(index + 1)
          .filter((audit) => audit.status === "completed");
  if (earlier.length === 0) return null;

  const items = earlier.map((audit) => ({
    value: audit.id,
    label: `${formatDate(audit.startedAt)} · ${audit.pagesCrawled} pages`,
  }));

  return (
    <Select
      items={items}
      value={null}
      onValueChange={(value) => {
        if (value) onCompare(value);
      }}
    >
      <SelectTrigger className="w-auto min-w-52" aria-label="Compare with">
        <GitCompare className="size-4" aria-hidden />
        <SelectValue placeholder="Compare with an earlier audit" />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
