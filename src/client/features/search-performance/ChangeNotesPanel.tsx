import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { ChangeNoteImpact } from "@/client/features/search-performance/ChangeNoteImpact";
import type {
  ChangeNote,
  NumberedNote,
} from "@/client/features/search-performance/SearchPerformanceChart";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addChangeNote,
  deleteChangeNote,
} from "@/serverFunctions/searchInsights";
import { CHANGE_NOTE_LABEL_MAX } from "@/types/schemas/change-notes";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function AddNoteForm({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [noteDate, setNoteDate] = useState(today);
  const [label, setLabel] = useState("");
  const add = useMutation({
    mutationFn: () =>
      addChangeNote({ data: { projectId, noteDate, label: label.trim() } }),
    onSuccess: () => {
      setLabel("");
      void queryClient.invalidateQueries({
        queryKey: ["changeNotes", projectId],
      });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Couldn't save the note")),
  });
  const canSave = label.trim().length > 0 && noteDate !== "" && !add.isPending;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) add.mutate();
      }}
    >
      <Input
        type="date"
        value={noteDate}
        onChange={(event) => setNoteDate(event.target.value)}
        aria-label="Date of the change"
        className="h-8 w-40 md:text-sm"
      />
      <Input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        maxLength={CHANGE_NOTE_LABEL_MAX}
        placeholder="What changed? e.g. Rewrote /pricing title"
        aria-label="What changed"
        className="h-8 min-w-48 flex-1 md:text-sm"
      />
      <Button type="submit" size="sm" disabled={!canSave}>
        Add note
      </Button>
    </form>
  );
}

/** Add, list and delete change notes; each can open its before/after view. */
export function ChangeNotesPanel({
  projectId,
  notes,
  numbered,
}: {
  projectId: string;
  notes: ChangeNote[];
  numbered: NumberedNote[];
}) {
  const queryClient = useQueryClient();
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (noteId: string) =>
      deleteChangeNote({ data: { projectId, noteId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["changeNotes", projectId],
      });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Couldn't delete the note")),
  });
  const numberById = new Map(
    numbered.map((item) => [item.note.id, item.number]),
  );

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div>
        <h3 className="text-sm font-medium">Change notes</h3>
        <p className="text-sm text-muted-foreground">
          Note the day you changed something. It is marked on the chart, and you
          can compare Search Console before and after it.
        </p>
      </div>
      <AddNoteForm projectId={projectId} />
      {notes.length > 0 ? (
        <ul className="max-h-96 space-y-2 overflow-auto">
          {notes.map((note) => {
            const number = numberById.get(note.id);
            const isOpen = openNoteId === note.id;
            return (
              <li key={note.id} className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className="w-5 shrink-0 text-center text-xs text-muted-foreground tabular-nums"
                    title={
                      number
                        ? "Marker number on the chart"
                        : "Outside the chart's date range"
                    }
                  >
                    {number ?? "–"}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {note.noteDate}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={note.label}>
                    {note.label}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant={isOpen ? "secondary" : "ghost"}
                    aria-expanded={isOpen}
                    onClick={() => setOpenNoteId(isOpen ? null : note.id)}
                  >
                    Before and after
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete note: ${note.label}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(note.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {isOpen ? (
                  <ChangeNoteImpact projectId={projectId} noteId={note.id} />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No change notes yet.</p>
      )}
    </div>
  );
}
