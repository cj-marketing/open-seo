import { SlidersHorizontal } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { SearchPerformanceSelects } from "@/client/features/search-performance/SearchPerformanceSelects";
import type { SearchPerformanceSearch } from "@/types/schemas/search-performance";

/** The row under the tabs: filters toggle, loading spinner, and the type,
 *  device, country and date-range selects. */
export function SearchPerformanceToolbar({
  showFilters,
  onToggleFilters,
  activeFilterCount,
  isFetching,
  search,
  countries,
  onSearchChange,
}: {
  showFilters: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
  isFetching: boolean;
  search: SearchPerformanceSearch;
  countries: { key: string }[];
  onSearchChange: (update: Partial<SearchPerformanceSearch>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <Button
        type="button"
        variant={showFilters ? "secondary" : "ghost"}
        size="sm"
        aria-expanded={showFilters}
        aria-controls="search-performance-filters"
        onClick={onToggleFilters}
        title="Toggle table filters"
      >
        <SlidersHorizontal data-icon="inline-start" />
        Filters
        {activeFilterCount > 0 ? (
          <Badge size="sm">{activeFilterCount}</Badge>
        ) : null}
      </Button>
      {isFetching ? <Spinner className="size-4 text-muted-foreground" /> : null}
      <SearchPerformanceSelects
        search={search}
        countries={countries}
        onSearchChange={onSearchChange}
      />
    </div>
  );
}
