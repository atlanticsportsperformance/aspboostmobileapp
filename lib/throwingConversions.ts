/**
 * Throwing velocity conversions and intensity calculations
 * Adapted from web app
 */

// Ball velocity ratios relative to 5oz baseball
export const BALL_VELOCITY_RATIOS: Record<string, number> = {
  '7oz': 0.928,      // 92.8% of 5oz baseball
  '6oz': 0.966,      // 96.6% of 5oz
  '5oz': 1.0,        // Baseball (baseline)
  '4oz': 1.027,      // 102.7% of 5oz
  '3oz': 1.05,       // 105% of 5oz
  'blue': 0.761,     // 76.1% of baseball
  'red': 0.884,      // 88.4% of baseball
  'yellow': 0.946,   // 94.6% of baseball
  'gray': 0.994,     // 99.4% of baseball
  'green': 1.0,      // Green is same as 5oz
};

/**
 * Determines if a metric is a throwing velocity metric
 */
export function isThrowingVelocityMetric(metricId: string): boolean {
  const throwingKeywords = ['velo', 'velocity', 'mph', 'baseball', 'ball'];
  const lowerMetricId = metricId.toLowerCase();
  return throwingKeywords.some(keyword => lowerMetricId.includes(keyword));
}

/**
 * Extract ball type from metric ID
 */
export function getBallTypeFromMetricId(metricId: string): string | null {
  const lowerMetricId = metricId.toLowerCase();

  // Check weighted balls
  if (lowerMetricId.includes('7oz')) return '7oz';
  if (lowerMetricId.includes('6oz')) return '6oz';
  if (lowerMetricId.includes('5oz')) return '5oz';
  if (lowerMetricId.includes('4oz')) return '4oz';
  if (lowerMetricId.includes('3oz')) return '3oz';

  // Check plyo balls
  if (lowerMetricId.includes('blue')) return 'blue';
  if (lowerMetricId.includes('red')) return 'red';
  if (lowerMetricId.includes('yellow')) return 'yellow';
  if (lowerMetricId.includes('gray')) return 'gray';
  if (lowerMetricId.includes('green')) return 'green';

  return null;
}

/**
 * Convert mound velocity (5oz) to other ball types
 */
export function convertFromMoundVelocity(moundVelocity: number, targetMetricId: string): number {
  const ballType = getBallTypeFromMetricId(targetMetricId);
  if (!ballType || !BALL_VELOCITY_RATIOS[ballType]) {
    return moundVelocity; // Default to same velocity if unknown
  }

  const ratio = BALL_VELOCITY_RATIOS[ballType];
  return Math.round(moundVelocity * ratio);
}

/**
 * Calculate throwing target based on athlete max, mound velocity, and intensity
 *
 * Priority:
 * 1. Use exercise-specific athlete max if available
 * 2. Fall back to mound velocity conversion
 * 3. Return null if neither available
 */
export function calculateThrowingTarget(
  athleteMax: number | null,
  moundVelocity: number | null,
  metricId: string,
  intensityPercent: number
): number | null {
  // If athlete has specific max for this metric, use it directly
  if (athleteMax !== null && athleteMax > 0) {
    return Math.round(athleteMax * (intensityPercent / 100));
  }

  // Fallback to mound velocity conversion
  if (moundVelocity !== null && moundVelocity > 0) {
    const convertedMax = convertFromMoundVelocity(moundVelocity, metricId);
    return Math.round(convertedMax * (intensityPercent / 100));
  }

  // No data available
  return null;
}

/**
 * Calculate target for non-throwing metrics (simple percentage)
 * Rounds to nearest 5 for strength exercises
 */
export function calculateStrengthTarget(
  athleteMax: number,
  intensityPercent: number,
  category?: string
): number {
  const isStrength = category?.toLowerCase().includes('strength') || category?.toLowerCase().includes('conditioning');
  const rawTarget = athleteMax * (intensityPercent / 100);

  if (isStrength) {
    // Round to nearest 5 for strength exercises
    return Math.round(rawTarget / 5) * 5;
  }

  return Math.round(rawTarget);
}
