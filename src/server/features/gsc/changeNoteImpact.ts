const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function addDays(date: string, days: number): string {
  return new Date(toMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

type ImpactWindows =
  | {
      status: "ok";
      /** Days actually compared on each side; less than the requested window
       *  when the after side is not complete yet. */
      comparedDays: number;
      before: { startDate: string; endDate: string };
      after: { startDate: string; endDate: string };
    }
  | { status: "no_after_data" }
  | { status: "no_before_data" };

/**
 * The before/after windows for a change made on `noteDate`.
 *
 * The note's own day is left out of both sides. "After" starts the day after
 * and runs `windowDays`, but GSC data ends `latestDate` (about 3 days back), so
 * a recent note has fewer complete days. Then only the available days are
 * compared, against a "before" window of the same length ending the day before
 * the note, so the two sides stay like for like. `earliestDate` is GSC's
 * retention floor: a before window that would start earlier is shortened too.
 */
export function computeImpactWindows(input: {
  noteDate: string;
  windowDays: number;
  latestDate: string;
  earliestDate: string;
}): ImpactWindows {
  const afterStart = addDays(input.noteDate, 1);
  const beforeEnd = addDays(input.noteDate, -1);
  const afterEndWanted = addDays(input.noteDate, input.windowDays);
  const afterEnd =
    afterEndWanted <= input.latestDate ? afterEndWanted : input.latestDate;
  const availableAfter = daysBetween(afterStart, afterEnd) + 1;
  if (availableAfter < 1) return { status: "no_after_data" };

  const availableBefore = daysBetween(input.earliestDate, beforeEnd) + 1;
  if (availableBefore < 1) return { status: "no_before_data" };

  const comparedDays = Math.min(availableAfter, availableBefore);
  return {
    status: "ok",
    comparedDays,
    before: {
      startDate: addDays(beforeEnd, -(comparedDays - 1)),
      endDate: beforeEnd,
    },
    after: {
      startDate: afterStart,
      endDate: addDays(afterStart, comparedDays - 1),
    },
  };
}
