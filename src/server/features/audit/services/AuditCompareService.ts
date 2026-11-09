import { sort } from "remeda";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import {
  countPageDifferences,
  countPages,
  getIssueClassGroups,
  getLighthouseScores,
  listClassIssues,
  listPageDifferences,
} from "@/server/features/audit/repositories/auditCompareQueries";
import { AppError } from "@/server/lib/errors";
import {
  ISSUE_SEVERITY_ORDER,
  type IssueSeverity,
} from "@/shared/audit-issues";
import type {
  CompareIssueClass,
  ComparePageKind,
} from "@/types/schemas/audit-compare";

// Past this share of the larger crawl, the two audits saw different sites.
const COVERAGE_WARNING_RATIO = 0.2;

type AuditRef = {
  id: string;
  startUrl: string;
  startedAt: string;
  completedAt: string | null;
  pageCount: number;
};

type IssueTypeComparison = {
  issueType: string;
  severity: IssueSeverity;
  base: number;
  target: number;
  new: number;
  fixed: number;
  onNewPage: number;
  onRemovedPage: number;
};

async function requireCompletedPair(
  projectId: string,
  baseAuditId: string,
  targetAuditId: string,
) {
  if (baseAuditId === targetAuditId) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Pick two different audits to compare.",
    );
  }
  const [base, target] = await Promise.all([
    AuditRepository.getAuditForProject(baseAuditId, projectId),
    AuditRepository.getAuditForProject(targetAuditId, projectId),
  ]);
  for (const [audit, id] of [
    [base, baseAuditId],
    [target, targetAuditId],
  ] as const) {
    if (!audit) {
      throw new AppError("NOT_FOUND", `Audit ${id} not found in this project.`);
    }
    if (audit.status !== "completed") {
      throw new AppError(
        "VALIDATION_ERROR",
        `Audit ${id} is ${audit.status}. Only completed audits can be compared.`,
      );
    }
  }
  if (!base || !target) throw new AppError("NOT_FOUND");
  return { base, target };
}

function coverageWarning(basePages: number, targetPages: number) {
  const larger = Math.max(basePages, targetPages);
  if (larger === 0) return null;
  if (Math.abs(basePages - targetPages) / larger <= COVERAGE_WARNING_RATIO) {
    return null;
  }
  return `The audits crawled a different number of pages (${basePages} vs ${targetPages}). New and fixed issues only count pages crawled in both; issues on pages only one audit crawled are listed separately as on new pages and on removed pages.`;
}

type ClassGroup = {
  issueType: string;
  severity: IssueSeverity;
  issueClass: string;
  count: number;
};

function addClassCount(
  entry: IssueTypeComparison,
  issueClass: string,
  amount: number,
) {
  // "persisting" is in both audits and only counts toward the totals.
  if (issueClass === "new") entry.new += amount;
  else if (issueClass === "fixed") entry.fixed += amount;
  else if (issueClass === "onNewPage") entry.onNewPage += amount;
  else if (issueClass === "onRemovedPage") entry.onRemovedPage += amount;
}

/** Folds the per-side class groups into one row per issue type. */
function foldIssueTypes(targetGroups: ClassGroup[], baseGroups: ClassGroup[]) {
  const byType = new Map<string, IssueTypeComparison>();
  const row = (issueType: string, severity: IssueSeverity) => {
    let existing = byType.get(issueType);
    if (!existing) {
      existing = {
        issueType,
        severity,
        base: 0,
        target: 0,
        new: 0,
        fixed: 0,
        onNewPage: 0,
        onRemovedPage: 0,
      };
      byType.set(issueType, existing);
    }
    return existing;
  };
  for (const group of targetGroups) {
    const entry = row(group.issueType, group.severity);
    entry.target += group.count;
    addClassCount(entry, group.issueClass, group.count);
  }
  for (const group of baseGroups) {
    const entry = row(group.issueType, group.severity);
    entry.base += group.count;
    addClassCount(entry, group.issueClass, group.count);
  }
  return sort(
    [...byType.values()],
    (a, b) =>
      ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity] ||
      b.new + b.fixed - (a.new + a.fixed) ||
      a.issueType.localeCompare(b.issueType),
  );
}

type Scores = {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
};

function pickScores(row: Scores): Scores {
  return {
    performance: row.performance,
    accessibility: row.accessibility,
    bestPractices: row.bestPractices,
    seo: row.seo,
  };
}

async function compareLighthouse(baseId: string, targetId: string) {
  const [baseRows, targetRows] = await Promise.all([
    getLighthouseScores(baseId),
    getLighthouseScores(targetId),
  ]);
  const baseByKey = new Map(
    baseRows.map((row) => [`${row.url}\n${row.strategy}`, row]),
  );
  const changes = [];
  for (const row of targetRows) {
    const before = baseByKey.get(`${row.url}\n${row.strategy}`);
    // Only URLs tested in both audits, and only when both runs scored.
    if (!before || before.performance == null || row.performance == null) {
      continue;
    }
    changes.push({
      url: row.url,
      strategy: row.strategy,
      base: pickScores(before),
      target: pickScores(row),
      performanceDelta: row.performance - before.performance,
    });
  }
  return sort(changes, (a, b) => a.performanceDelta - b.performanceDelta);
}

function toAuditRef(
  audit: {
    id: string;
    startUrl: string;
    startedAt: string;
    completedAt: string | null;
  },
  pageCount: number,
): AuditRef {
  return {
    id: audit.id,
    startUrl: audit.startUrl,
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    pageCount,
  };
}

/** Everything the compare view shows outside the paged lists. */
async function compare(
  projectId: string,
  baseAuditId: string,
  targetAuditId: string,
) {
  const { base, target } = await requireCompletedPair(
    projectId,
    baseAuditId,
    targetAuditId,
  );
  const [basePages, targetPages, targetGroups, baseGroups, pages, lighthouse] =
    await Promise.all([
      countPages(base.id),
      countPages(target.id),
      getIssueClassGroups(target.id, base.id, "target"),
      getIssueClassGroups(base.id, target.id, "base"),
      countPageDifferences(base.id, target.id),
      compareLighthouse(base.id, target.id),
    ]);

  const issueTypes = foldIssueTypes(targetGroups, baseGroups);
  const totals = { new: 0, fixed: 0, onNewPage: 0, onRemovedPage: 0 };
  for (const entry of issueTypes) {
    totals.new += entry.new;
    totals.fixed += entry.fixed;
    totals.onNewPage += entry.onNewPage;
    totals.onRemovedPage += entry.onRemovedPage;
  }

  return {
    base: toAuditRef(base, basePages),
    target: toAuditRef(target, targetPages),
    coverageWarning: coverageWarning(basePages, targetPages),
    totals,
    issueTypes,
    pages,
    lighthouse,
  };
}

function targetUrlOf(detailsJson: string | null): string | null {
  if (!detailsJson) return null;
  try {
    const parsed: unknown = JSON.parse(detailsJson);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "targetUrl" in parsed &&
      typeof parsed.targetUrl === "string"
    ) {
      return parsed.targetUrl;
    }
  } catch {
    // Unreadable details only lose the link target.
  }
  return null;
}

async function listIssues(
  projectId: string,
  input: {
    baseAuditId: string;
    targetAuditId: string;
    issueClass: CompareIssueClass;
    issueType?: string;
    page: number;
    pageSize: number;
  },
) {
  await requireCompletedPair(projectId, input.baseAuditId, input.targetAuditId);
  const { rows, totalCount } = await listClassIssues(input);
  return {
    totalCount,
    rows: rows.map(({ detailsJson, ...row }) => ({
      ...row,
      linkTarget: targetUrlOf(detailsJson),
    })),
  };
}

async function listPages(
  projectId: string,
  input: {
    baseAuditId: string;
    targetAuditId: string;
    kind: ComparePageKind;
    page: number;
    pageSize: number;
  },
) {
  await requireCompletedPair(projectId, input.baseAuditId, input.targetAuditId);
  return listPageDifferences(input);
}

export const AuditCompareService = {
  compare,
  listIssues,
  listPages,
} as const;
