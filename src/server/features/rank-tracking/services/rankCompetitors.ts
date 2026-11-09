import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";

/**
 * Competitors read from each check. Every one adds a row per keyword and
 * device to each run, so the list is capped; the first by domain are used.
 */
const MAX_RANK_COMPETITORS = 10;

function bareHost(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z\d+.-]*:\/\//, "")
    .replace(/[/?#:].*$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

/**
 * The project's competitor domains for a tracker: normalized, deduplicated,
 * without the tracked domain or its subdomains (those are our own position).
 */
export async function loadRankCompetitorDomains(
  projectId: string,
  trackedDomain: string,
): Promise<string[]> {
  const competitors = await ProjectContextRepository.listCompetitors(projectId);
  const own = bareHost(trackedDomain);
  const domains = competitors
    .map((competitor) => bareHost(competitor.domain))
    .filter(
      (domain) =>
        domain !== "" && domain !== own && !domain.endsWith(`.${own}`),
    );
  return [...new Set(domains)].slice(0, MAX_RANK_COMPETITORS);
}
