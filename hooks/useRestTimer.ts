import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { secondsRemaining } from '../lib/logger/rest';

// Rest countdown driven by a stored end timestamp, so it stays correct across
// re-renders and while the app is backgrounded. secondsLeft is null when idle.
export function useRestTimer(): { secondsLeft: number | null; start: (sec: number) => void; clear: () => void } {
  const endAt = useRef<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const clear = useCallback(() => {
    endAt.current = null;
    setSecondsLeft(null);
  }, []);

  const tick = useCallback(() => {
    if (endAt.current == null) return;
    const left = secondsRemaining(endAt.current, Date.now());
    if (left <= 0) {
      endAt.current = null;
      setSecondsLeft(null);
    } else {
      setSecondsLeft(left);
    }
  }, []);

  const start = useCallback((sec: number) => {
    if (!(sec > 0)) {
      clear();
      return;
    }
    endAt.current = Date.now() + sec * 1000;
    setSecondsLeft(Math.ceil(sec));
  }, [clear]);

  useEffect(() => {
    if (secondsLeft == null) return;
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [secondsLeft == null, tick]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') tick();
    });
    return () => sub.remove();
  }, [tick]);

  return { secondsLeft, start, clear };
}
