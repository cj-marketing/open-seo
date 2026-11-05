import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { BingWebmasterPage } from "@/client/features/bing-webmaster/BingWebmasterPage";
import {
  BING_DEFAULT_DAYS,
  bingSearchSchema,
} from "@/types/schemas/bing-webmaster";

export const Route = createFileRoute("/_app/p/$projectId/bing")({
  validateSearch: bingSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({ days: BING_DEFAULT_DAYS, tab: "queries" }),
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
