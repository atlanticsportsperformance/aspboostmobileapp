/**
 * Tiny global pub/sub for pulse-side events that need to cross component
 * boundaries without prop drilling. Specifically: when usePulseSync.commit()
 * succeeds, the ThrowingThrowsFeed needs to refetch — but the feed and the
 * sync hook live in sibling components with no shared parent state.
 *
 * This avoids a big refactor of pushing usePulseSync up to every screen that
 * mounts the feed. Trade-off: it's a global, but it's tiny, scoped to pulse,
 * and only fires on real commit-success events.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export const pulseEvents = {
  /** Subscribe to throws-committed events. Returns an unsubscribe function. */
  onThrowsCommitted(cb: Listener): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },

  /** Fire after a successful pulse_throws insert batch. */
  emitThrowsCommitted(): void {
    listeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error('[pulseEvents] listener threw', err);
      }
    });
  },
};
