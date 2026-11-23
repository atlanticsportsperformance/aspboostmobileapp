/**
 * useInView — true while the referenced view is on screen.
 *
 * The home feed is one long ScrollView with no shared scroll context, so
 * this polls `measureInWindow` (cheap; ~5×/s) instead of threading scroll
 * events through every section. Used to start animations only when the
 * athlete actually scrolls to a section, and to restart them each time
 * it comes back into view.
 */
import { useEffect, useRef, useState } from 'react';
import { Dimensions, View } from 'react-native';

export function useInView<T extends View = View>(threshold = 0.25) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = () => {
      const node = ref.current;
      if (!node || !alive) return;
      node.measureInWindow((_x, y, _w, h) => {
        if (!alive || h === 0) return;
        const screenH = Dimensions.get('window').height;
        const visible = Math.min(y + h, screenH) - Math.max(y, 0);
        const next = visible > Math.min(h, screenH) * threshold;
        setInView((prev) => (prev === next ? prev : next));
      });
    };
    const id = setInterval(check, 200);
    check();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [threshold]);

  return { ref, inView };
}
