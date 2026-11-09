import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QueryState } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/client/components/ui/field";
import { Input } from "@/client/components/ui/input";
import { Switch } from "@/client/components/ui/switch";
import {
  clampMaxPagesInput,
  MIN_PAGES,
} from "@/client/features/audit/launch/types";
import { formatStartedAt } from "@/client/features/audit/shared";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getAuditSchedule,
  saveAuditSchedule,
} from "@/serverFunctions/audit-insights";
import { DEFAULT_AUDIT_PAGES } from "@/shared/audit-limits";
import { describeAuditScheduleSkipReason } from "@/shared/audit-schedule";

type Schedule = Awaited<ReturnType<typeof getAuditSchedule>>;

type Props = {
  projectId: string;
  /** Pre-fills the start URL of a schedule that does not exist yet. */
  defaultUrl: string;
  maxPagesLimit: number;
  canRenderJavaScript?: boolean;
};

/** One monthly audit per project; off until the user turns it on. */
export function AuditScheduleCard(props: Props) {
  const query = useQuery({
    queryKey: ["audit-schedule", props.projectId],
    queryFn: () => getAuditSchedule({ data: { projectId: props.projectId } }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Monthly Audit</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState
          query={query}
          errorFallback="Failed to load the audit schedule"
        >
          {(schedule) => <ScheduleForm {...props} schedule={schedule} />}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function ScheduleForm({
  projectId,
  defaultUrl,
  maxPagesLimit,
  canRenderJavaScript,
  schedule,
}: Props & { schedule: Schedule }) {
  const queryClient = useQueryClient();
  const [isActive, setIsActive] = useState(schedule?.isActive ?? false);
  const [startUrl, setStartUrl] = useState(schedule?.startUrl ?? defaultUrl);
  const [maxPagesInput, setMaxPagesInput] = useState(
    String(schedule?.maxPages ?? DEFAULT_AUDIT_PAGES),
  );
  const [lighthouse, setLighthouse] = useState(
    schedule?.lighthouseStrategy === "auto",
  );
  const [renderJavaScript, setRenderJavaScript] = useState(
    schedule?.renderJavaScript ?? false,
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      saveAuditSchedule({
        data: {
          projectId,
          isActive,
          startUrl,
          maxPages: clampMaxPagesInput(maxPagesInput, maxPagesLimit),
          lighthouseStrategy: lighthouse ? "auto" : "none",
          renderJavaScript,
        },
      }),
    onSuccess: async () => {
      toast.success("Schedule saved");
      await queryClient.invalidateQueries({
        queryKey: ["audit-schedule", projectId],
      });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to save schedule")),
  });

  const skipText = describeAuditScheduleSkipReason(
    schedule?.lastSkipReason ?? null,
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        saveMutation.mutate();
      }}
    >
      <div className="flex items-center gap-2">
        <Switch
          id="audit-schedule-active"
          checked={isActive}
          onCheckedChange={setIsActive}
        />
        <FieldLabel htmlFor="audit-schedule-active">
          Audit this site every month
        </FieldLabel>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="audit-schedule-url">Start URL</FieldLabel>
          <Input
            id="audit-schedule-url"
            placeholder="https://example.com"
            value={startUrl}
            onChange={(event) => setStartUrl(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="audit-schedule-pages">Max pages</FieldLabel>
          <Input
            id="audit-schedule-pages"
            type="number"
            min={MIN_PAGES}
            max={maxPagesLimit}
            className="w-28"
            value={maxPagesInput}
            onChange={(event) => {
              if (/^\d*$/.test(event.target.value)) {
                setMaxPagesInput(event.target.value);
              }
            }}
            onBlur={() =>
              setMaxPagesInput(
                String(clampMaxPagesInput(maxPagesInput, maxPagesLimit)),
              )
            }
          />
        </Field>
      </div>

      <Field>
        <div className="flex items-center gap-2">
          <Switch
            id="audit-schedule-lighthouse"
            checked={lighthouse}
            onCheckedChange={setLighthouse}
          />
          <FieldLabel htmlFor="audit-schedule-lighthouse">
            Include Lighthouse
          </FieldLabel>
        </div>
        {lighthouse ? (
          <FieldDescription>
            Every scheduled audit tests up to 10 pages on mobile and desktop.
            These are paid DataForSEO requests billed to the operator&apos;s
            account.
          </FieldDescription>
        ) : null}
      </Field>

      {canRenderJavaScript ? (
        <div className="flex items-center gap-2">
          <Switch
            id="audit-schedule-render"
            checked={renderJavaScript}
            onCheckedChange={setRenderJavaScript}
          />
          <FieldLabel htmlFor="audit-schedule-render">
            Render JavaScript
          </FieldLabel>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          pending={saveMutation.isPending}
          disabled={startUrl.trim() === ""}
        >
          Save schedule
        </Button>
        <p className="text-sm text-muted-foreground">
          {schedule?.isActive && schedule.nextCheckAt
            ? `Next audit: ${formatStartedAt(schedule.nextCheckAt)} (end of the month)`
            : "Runs at the end of each month once switched on."}
        </p>
      </div>
      {schedule?.lastStartedAt ? (
        <p className="text-sm text-muted-foreground">
          Last scheduled audit: {formatStartedAt(schedule.lastStartedAt)}
        </p>
      ) : null}
      {skipText ? (
        <p className="text-sm text-warning">Last run skipped: {skipText}</p>
      ) : null}
    </form>
  );
}
