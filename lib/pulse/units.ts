/** Arm speed: the decoder stores degrees/sec; the Pulse iOS app displays RPM.
 *  360°/rev × 60 s/min → rpm = dps / 6. */
export function dpsToRpm(dps: number | null): number | null {
  if (dps == null) return null;
  return Math.round(dps / 6);
}
