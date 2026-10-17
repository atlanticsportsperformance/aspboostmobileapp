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
