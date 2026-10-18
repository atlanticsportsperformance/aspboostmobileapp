// Draft saves for the logger (spec §11.2), with a "real edit" guard.
//
// Opening an exercise, selecting / tapping a set row, scrolling, a keypad
// opened and closed, an auto-fill / back-off re-apply that lands on the value
// already there, and the rack follow NEVER write. A draft fires only for a
// field whose value differs from what the set holds on the server (loaded at
// resume, then updated by every save / rack row). Drafts send only those
// changed fields — never is_complete.

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
};

/** Values compare as text: 3, "3" and "3" are one value; null / undefined / "" are "empty". */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v == null ? '' : String(v));
  return norm(a) === norm(b);
}

export interface DraftWriter {
  /** What the server holds for a set (resume load, a saved write, a rack row). */
  setSaved(key: string, values: Record<string, unknown>): void;
  /** Mark fields as saved with these values (after a write was queued). */
  markSaved(key: string, fields: string[], values: Record<string, unknown>): void;
  /**
   * A field changed locally. Schedules a debounced draft for it when the
   * value differs from the saved one; a change back to the saved value drops
   * it from the pending draft (and cancels the draft when nothing is left).
   */
  edit(key: string, field: string, value: unknown): void;
  /** Cancel a set's pending draft; returns the fields it would have written (the caller's write carries them). */
  take(key: string): string[];
  /** Fields pending for a set (tests / debugging). */
  pending(key: string): string[];
  /** What the phone last knew the server holds for a set (the baseline drafts diff against). */
  savedOf(key: string): Record<string, unknown> | undefined;
}

export function createDraftWriter(opts: {
  /** Persist a draft: only these fields of the set (never is_complete). */
  persist: (key: string, fields: string[]) => void;
  delayMs?: number;
  timers?: Timers;
}): DraftWriter {
  const delayMs = opts.delayMs ?? 500;
  const timers: Timers = opts.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const saved = new Map<string, Record<string, unknown>>();
  const fieldsOf = new Map<string, Set<string>>();
  const timerOf = new Map<string, unknown>();

  const cancelTimer = (key: string) => {
    const t = timerOf.get(key);
    if (t != null) timers.clearTimeout(t);
    timerOf.delete(key);
  };

  return {
    setSaved(key, values) {
      saved.set(key, { ...values });
    },
    markSaved(key, fields, values) {
      const cur = { ...(saved.get(key) ?? {}) };
      for (const f of fields) cur[f] = values[f];
      saved.set(key, cur);
    },
    edit(key, field, value) {
      const pending = fieldsOf.get(key) ?? new Set<string>();
      if (sameValue(value, saved.get(key)?.[field])) {
        // No real change (a re-apply, a keypad closed untouched, edited back).
        pending.delete(field);
      } else {
        pending.add(field);
      }
      cancelTimer(key);
      if (pending.size === 0) {
        fieldsOf.delete(key);
        return;
      }
      fieldsOf.set(key, pending);
      timerOf.set(
        key,
        timers.setTimeout(() => {
          timerOf.delete(key);
          const fields = [...(fieldsOf.get(key) ?? [])];
          fieldsOf.delete(key);
          if (fields.length) opts.persist(key, fields);
        }, delayMs),
      );
    },
    take(key) {
      cancelTimer(key);
      const fields = [...(fieldsOf.get(key) ?? [])];
      fieldsOf.delete(key);
      return fields;
    },
    pending: key => [...(fieldsOf.get(key) ?? [])],
    savedOf: key => saved.get(key),
  };
}
