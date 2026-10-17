import { useEffect } from 'react';
import { AppState } from 'react-native';
import { loggerOutbox } from '../lib/logger/outbox';
import { flushPendingCompletions } from '../lib/logger/pendingComplete';

// App-level sync for the logger outbox (spec §7): queued sets go out on app
// start and whenever the app comes back to the foreground, whether or not a
// workout logger is open. Only while signed in — the RPC needs a session.
export function useOutboxForegroundSync(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) return;
    void loggerOutbox.flush({ foreground: true });
    void flushPendingCompletions();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void loggerOutbox.flush({ foreground: true });
      if (state === 'active') void flushPendingCompletions();
    });
    return () => sub.remove();
  }, [signedIn]);
}
