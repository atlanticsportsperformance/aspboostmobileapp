import { useEffect } from 'react';
import { AppState } from 'react-native';
import { syncAll } from '../lib/logger/syncAll';

// App-level sync for the logger outbox (spec §7): queued sets go out on app
// start and whenever the app comes back to the foreground, whether or not a
// workout logger is open. Only while signed in — the RPC needs a session.
// Sets flush first, then queued completions (lib/logger/syncAll.ts).
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
