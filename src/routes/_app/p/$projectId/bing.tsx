import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { BingWebmasterPage } from "@/client/features/bing-webmaster/BingWebmasterPage";
import { bingSearchSchema } from "@/types/schemas/bing-webmaster";
import { SEARCH_PERFORMANCE_DEFAULT_PAGE_SIZE } from "@/types/schemas/search-performance";

export const Route = createFileRoute("/_app/p/$projectId/bing")({
  validateSearch: bingSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({
        tab: "striking",
        range: "last_28_days",
        page: 1,
        size: SEARCH_PERFORMANCE_DEFAULT_PAGE_SIZE,
      }),
    ],
  },
  component: BingRoute,
});

function BingRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  return (
    <BingWebmasterPage
      projectId={projectId}
      search={search}
      onSearchChange={(update) => {
        void navigate({
          search: (prev) => ({ ...prev, ...update }),
          replace: true,
        });
      }}
    />
  );
}
