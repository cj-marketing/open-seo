import { z } from "zod";

/**
 * How an issue differs between two audits of the same site. Crawl coverage
 * differs between audits (50 pages vs 323), so an issue only counts as new or
 * fixed when the page was crawled cleanly in both:
 *   new           in the later audit only, page crawled in both
 *   fixed         in the earlier audit only, page crawled in both
 *   onNewPage     in the later audit, page not crawled cleanly in the earlier
 *   onRemovedPage in the earlier audit, page not crawled cleanly in the later
 */
export const COMPARE_ISSUE_CLASSES = [
  "new",
  "fixed",
  "onNewPage",
  "onRemovedPage",
] as const;
export type CompareIssueClass = (typeof COMPARE_ISSUE_CLASSES)[number];

export const COMPARE_PAGE_KINDS = ["added", "removed", "changed"] as const;
export type ComparePageKind = (typeof COMPARE_PAGE_KINDS)[number];

export const COMPARE_MAX_PAGE_SIZE = 200;
export const COMPARE_DEFAULT_PAGE_SIZE = 50;

const auditPairShape = {
  projectId: z.string().min(1),
  baseAuditId: z.string().min(1),
  targetAuditId: z.string().min(1),
};

const pagingShape = {
  page: z.number().int().positive().default(1),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(COMPARE_MAX_PAGE_SIZE)
    .default(COMPARE_DEFAULT_PAGE_SIZE),
};

export const compareAuditsSchema = z.object(auditPairShape);

export const compareIssuesSchema = z.object({
  ...auditPairShape,
  issueClass: z.enum(COMPARE_ISSUE_CLASSES),
  issueType: z.string().min(1).max(100).optional(),
  ...pagingShape,
});

export const comparePagesSchema = z.object({
  ...auditPairShape,
  kind: z.enum(COMPARE_PAGE_KINDS),
  ...pagingShape,
});
