import { z } from "zod";

export const CHANGE_NOTE_WINDOW_DAYS = [7, 14, 28] as const;
export const CHANGE_NOTE_LABEL_MAX = 120;
export const CHANGE_NOTE_LIST_LIMIT = 200;

const changeNoteDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Not a real date");

const changeNoteLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHANGE_NOTE_LABEL_MAX);

export const changeNoteWindowSchema = z
  .number()
  .int()
  .refine((value) =>
    (CHANGE_NOTE_WINDOW_DAYS as readonly number[]).includes(value),
  );

export const listChangeNotesSchema = z.object({
  projectId: z.string().min(1),
});

export const addChangeNoteSchema = z.object({
  projectId: z.string().min(1),
  noteDate: changeNoteDateSchema,
  label: changeNoteLabelSchema,
});

export const deleteChangeNoteSchema = z.object({
  projectId: z.string().min(1),
  noteId: z.string().min(1),
});

export const changeNoteImpactSchema = z.object({
  projectId: z.string().min(1),
  noteId: z.string().min(1),
  windowDays: changeNoteWindowSchema.default(28),
  pageContains: z.string().trim().min(1).max(2048).optional(),
});
