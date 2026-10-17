// Sets first; a queued "complete workout" is replayed only after the set
// outbox flush has settled (success or failure).
import { loggerOutbox, type Outbox } from './outbox';
import { pendingCompletions } from './pendingComplete';

type Flushable = { flush: () => Promise<number> };

export function createSyncAll(outbox: Pick<Outbox, 'flush'> = loggerOutbox, pending: Flushable = pendingCompletions) {
  return () =>
    outbox
      .flush({ foreground: true })
      .catch(() => 0)
      .then(() => pending.flush())
      .catch(e => console.error('[sync] pending completions failed', e));
}

export const syncAll = createSyncAll();

// Pre-finish flush with a cap (final review I3): on captive / flaky Wi-Fi a
// flush can stall for minutes, so Finish waits at most `capMs`. Resolves true
// if the flush settled in time (success or failure), false on the cap. The
// flush itself keeps running.
export const FINISH_FLUSH_CAP_MS = 3000;
export function flushWithCap(flush: () => Promise<unknown>, capMs: number = FINISH_FLUSH_CAP_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(false), capMs);
  });
  const settled = Promise.resolve()
    .then(flush)
    .then(() => true, () => true);
  return Promise.race([settled, cap]).finally(() => clearTimeout(timer));
}
