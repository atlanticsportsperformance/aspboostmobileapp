import { useEffect } from 'react';
import { AppState } from 'react-native';
import { loggerOutbox } from '../lib/logger/outbox';
import { pendingCompletions } from '../lib/logger/pendingComplete';

// Sets first; a queued "complete workout" is replayed only after the set
// outbox flush has settled (success or failure).
const syncAll = () =>
  loggerOutbox
    .flush({ foreground: true })
    .catch(() => 0)
    .then(() => pendingCompletions.flush())
    .catch(e => console.error('[sync] pending completions failed', e));

// App-level sync for the logger outbox (spec §7): queued sets go out on app
// start and whenever the app comes back to the foreground, whether or not a
// workout logger is open. Only while signed in — the RPC needs a session.
export function useOutboxForegroundSync(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) return;
    void syncAll();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void syncAll();
    });
    return () => sub.remove();
  }, [signedIn]);
}
