/**
 * SQL behind audit compare. An audit can hold 10,000 pages and tens of
 * thousands of issues, so every comparison is an EXISTS against the other
 * audit (served by the (audit_id, url) and (audit_id, issue_type, page_url)
 * indexes) and lists come one page at a time. Nothing loads a whole audit.
 *
 * Tables are referenced by name inside the raw fragments: Drizzle writes
 * columns unqualified in a one-table select, so the other audit's rows are
 * aliased `o`/`p` and the audit being read is always the unaliased table.
 */
import { and, asc, count, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { getDatabaseProvider } from "@/db/provider";
import { auditIssues, auditLighthouseResults, auditPages } from "@/db/schema";
import type { CompareIssueClass } from "@/types/schemas/audit-compare";

type Side = "target" | "base";
type PageKind = "added" | "removed" | "changed";

// An issue's identity is (type, page); a broken link also needs the link it
// points at, since one page can have several broken links.
function issueTarget(alias: string): SQL {
  const details = sql.raw(`${alias}.details_json`);
  const extracted =
    getDatabaseProvider() === "postgres"
      ? sql`(${details}::json ->> 'targetUrl')`
      : sql`json_extract(${details}, '$.targetUrl')`;
  return sql`case when ${sql.raw(`${alias}.issue_type`)} = 'broken-internal-link' then coalesce(${extracted}, '') else '' end`;
}

function issueInAudit(otherAuditId: string): SQL {
  return sql`exists (
    select 1 from audit_issues o
    where o.audit_id = ${otherAuditId}
    and o.issue_type = audit_issues.issue_type
    and o.page_url = audit_issues.page_url
    and ${issueTarget("o")} = ${issueTarget("audit_issues")}
  )`;
}

// "Crawled" means fetched cleanly: a page the other audit could not read
// (blocked, rate limited, error) has no trustworthy issue list to compare.
function pageCrawledInAudit(otherAuditId: string): SQL {
  return sql`exists (
    select 1 from audit_pages p
    where p.audit_id = ${otherAuditId}
    and p.url = audit_issues.page_url
    and p.fetch_class = 'ok'
  )`;
}

/** The class of each issue of one audit, judged against the other audit. */
function issueClassOf(side: Side, otherAuditId: string): SQL {
  const [present, absent] =
    side === "target"
      ? (["new", "onNewPage"] as const)
      : (["fixed", "onRemovedPage"] as const);
  return sql`(case
    when ${issueInAudit(otherAuditId)} then 'persisting'
    when ${pageCrawledInAudit(otherAuditId)} then ${sql.raw(`'${present}'`)}
    else ${sql.raw(`'${absent}'`)}
  end)`;
}

/** Issue counts per type, severity and class for one side of a comparison. */
export function getIssueClassGroups(
  auditId: string,
  otherAuditId: string,
  side: Side,
) {
  return (
    db
      .select({
        issueType: auditIssues.issueType,
        severity: auditIssues.severity,
        issueClass: sql<string>`${issueClassOf(side, otherAuditId)}`,
        count: count(),
      })
      .from(auditIssues)
      .where(eq(auditIssues.auditId, auditId))
      // By position: the class expression carries bound parameters, and
      // Postgres will not match a repeated expression to the select list.
      .groupBy(sql`1`, sql`2`, sql`3`)
  );
}

function classWhere(
  issueClass: CompareIssueClass,
  baseAuditId: string,
  targetAuditId: string,
  issueType?: string,
) {
  const isTargetSide = issueClass === "new" || issueClass === "onNewPage";
  const auditId = isTargetSide ? targetAuditId : baseAuditId;
  const side: Side = isTargetSide ? "target" : "base";
  const otherAuditId = isTargetSide ? baseAuditId : targetAuditId;
  return and(
    eq(auditIssues.auditId, auditId),
    issueType ? eq(auditIssues.issueType, issueType) : undefined,
    sql`${issueClassOf(side, otherAuditId)} = ${issueClass}`,
  );
}

export async function listClassIssues(input: {
  baseAuditId: string;
  targetAuditId: string;
  issueClass: CompareIssueClass;
  issueType?: string;
  page: number;
  pageSize: number;
}) {
  const where = classWhere(
    input.issueClass,
    input.baseAuditId,
    input.targetAuditId,
    input.issueType,
  );
  const [rows, totals] = await Promise.all([
    db
      .select({
        issueType: auditIssues.issueType,
        severity: auditIssues.severity,
        pageUrl: auditIssues.pageUrl,
        detailsJson: auditIssues.detailsJson,
      })
      .from(auditIssues)
      .where(where)
      // Severity first, so a cut-off list drops info rows, never critical ones.
      .orderBy(
        sql`case ${auditIssues.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`,
        asc(auditIssues.issueType),
        asc(auditIssues.pageUrl),
        asc(auditIssues.id),
      )
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ total: count() }).from(auditIssues).where(where),
  ]);
  return { rows, totalCount: totals[0]?.total ?? 0 };
}

export async function countPages(auditId: string) {
  const rows = await db
    .select({ total: count() })
    .from(auditPages)
    .where(eq(auditPages.auditId, auditId));
  return rows[0]?.total ?? 0;
}

function missingFrom(otherAuditId: string): SQL {
  return sql`not exists (
    select 1 from audit_pages o
    where o.audit_id = ${otherAuditId} and o.url = audit_pages.url
  )`;
}

// Pages in both audits whose status code or title differ.
function changedSince(baseAuditId: string): SQL {
  return sql`exists (
    select 1 from audit_pages o
    where o.audit_id = ${baseAuditId}
    and o.url = audit_pages.url
    and (
      coalesce(o.status_code, -1) <> coalesce(audit_pages.status_code, -1)
      or coalesce(o.title, '') <> coalesce(audit_pages.title, '')
    )
  )`;
}

function pagesWhere(
  kind: PageKind,
  baseAuditId: string,
  targetAuditId: string,
) {
  if (kind === "added") {
    return and(eq(auditPages.auditId, targetAuditId), missingFrom(baseAuditId));
  }
  if (kind === "removed") {
    return and(eq(auditPages.auditId, baseAuditId), missingFrom(targetAuditId));
  }
  return and(eq(auditPages.auditId, targetAuditId), changedSince(baseAuditId));
}

export async function countPageDifferences(
  baseAuditId: string,
  targetAuditId: string,
) {
  const countKind = async (kind: PageKind) => {
    const rows = await db
      .select({ total: count() })
      .from(auditPages)
      .where(pagesWhere(kind, baseAuditId, targetAuditId));
    return rows[0]?.total ?? 0;
  };
  const [added, removed, changed] = await Promise.all([
    countKind("added"),
    countKind("removed"),
    countKind("changed"),
  ]);
  return { added, removed, changed };
}

export async function listPageDifferences(input: {
  baseAuditId: string;
  targetAuditId: string;
  kind: PageKind;
  page: number;
  pageSize: number;
}) {
  const where = pagesWhere(input.kind, input.baseAuditId, input.targetAuditId);
  // A removed page is the base audit's row; otherwise it is the target's.
  // Every row also carries the base audit's values for a before/after.
  const [rows, totals] = await Promise.all([
    db
      .select({
        url: auditPages.url,
        statusCode: auditPages.statusCode,
        title: auditPages.title,
        baseStatusCode: sql<number | null>`(
          select o.status_code from audit_pages o
          where o.audit_id = ${input.baseAuditId} and o.url = audit_pages.url
          limit 1
        )`,
        baseTitle: sql<string | null>`(
          select o.title from audit_pages o
          where o.audit_id = ${input.baseAuditId} and o.url = audit_pages.url
          limit 1
        )`,
      })
      .from(auditPages)
      .where(where)
      .orderBy(asc(auditPages.url), asc(auditPages.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ total: count() }).from(auditPages).where(where),
  ]);
  return { rows, totalCount: totals[0]?.total ?? 0 };
}

/** At most 20 rows per audit (a 10-page sample, mobile and desktop). */
export function getLighthouseScores(auditId: string) {
  return db
    .select({
      url: auditPages.url,
      strategy: auditLighthouseResults.strategy,
      performance: auditLighthouseResults.performanceScore,
      accessibility: auditLighthouseResults.accessibilityScore,
      bestPractices: auditLighthouseResults.bestPracticesScore,
      seo: auditLighthouseResults.seoScore,
    })
    .from(auditLighthouseResults)
    .innerJoin(auditPages, eq(auditPages.id, auditLighthouseResults.pageId))
    .where(eq(auditLighthouseResults.auditId, auditId));
}
