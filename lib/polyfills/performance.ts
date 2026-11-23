/**
 * React Native's `performance` lacks the User Timing clear/mark helpers
 * that @react-three/fiber's bundled React reconciler calls in dev.
 * Fill in no-ops so the 3D home-screen views can mount.
 */
const g = globalThis as unknown as { performance?: Record<string, unknown> };
const perf = g.performance ?? (g.performance = {});
for (const fn of ['mark', 'measure', 'clearMarks', 'clearMeasures']) {
  if (typeof perf[fn] !== 'function') perf[fn] = () => {};
}
export {};
