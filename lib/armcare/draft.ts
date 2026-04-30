/**
 * AsyncStorage draft persistence for ArmCare exam saves.
 *
 * Why: a successful 8-rep exam takes ~3 minutes of work. If the Supabase
 * insert fails (network blip, RLS denial, server hiccup), we don't want all
 * of that data gone. The wizard stashes the row payload locally before the
 * insert. On success we clear it; on failure it remains so the user can
 * retry. The hub + wizard intro both check for a stash and surface a
 * "Recover unsaved exam" CTA when one exists.
 *
 * Keyed by athleteId so a parent flipping between multiple kids doesn't
 * cross-pollute drafts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SessionResult } from './types';
import { toArmcareSessionRow } from './scoring';

const KEY_PREFIX = 'armcare_pending_exam:';
/**
 * Drafts older than this are considered stale and silently discarded on
 * read. Keeps the recovery card from surfacing a 6-week-old exam the user
 * has clearly moved past.
 */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ArmCareDraft {
  athleteId: string;
  /** ISO timestamp when the draft was written (Date.now()). */
  savedAt: number;
  /** The fully-computed SessionResult (so we can re-render the review screen). */
  session: SessionResult;
  /** The maxVelo we resolved at save-time, if any. */
  maxVelo: number | null;
  /** The exact column-shaped row we tried to insert. */
  row: ReturnType<typeof toArmcareSessionRow>;
}

function key(athleteId: string): string {
  return `${KEY_PREFIX}${athleteId}`;
}

export async function saveDraft(
  athleteId: string,
  session: SessionResult,
  maxVelo: number | null,
): Promise<void> {
  try {
    const row = toArmcareSessionRow(session, maxVelo);
    const draft: ArmCareDraft = {
      athleteId,
      savedAt: Date.now(),
      session,
      maxVelo,
      row,
    };
    await AsyncStorage.setItem(key(athleteId), JSON.stringify(draft));
  } catch (err) {
    console.warn('[armcare] saveDraft failed', err);
  }
}

export async function readDraft(athleteId: string): Promise<ArmCareDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(key(athleteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ArmCareDraft;
    if (parsed?.athleteId !== athleteId) return null;
    // Discard drafts past the TTL so the recovery card doesn't haunt the
    // intro screen forever after a long-abandoned save.
    if (typeof parsed.savedAt !== 'number' ||
        Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      await AsyncStorage.removeItem(key(athleteId));
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[armcare] readDraft failed', err);
    return null;
  }
}

export async function clearDraft(athleteId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(athleteId));
  } catch (err) {
    console.warn('[armcare] clearDraft failed', err);
  }
}

/** Pretty-print the draft's age for surface UI ("3m ago", "1h ago"). */
export function draftAgeLabel(draft: ArmCareDraft): string {
  const ms = Date.now() - draft.savedAt;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
