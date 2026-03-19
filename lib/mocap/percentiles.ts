/**
 * Percentile computation and metric definitions for mocap biomechanics.
 * Extracted from web PercentileRadar.tsx — pure logic, no UI.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PercentileTable {
  cohort: string
  sampleSize: number
  metrics: Record<string, { percentiles: Record<string, number> }>
}

export interface MetricDef {
  key: string
  percKey: string
  axisLabel: string
  explanation: string
  unit: string
  invert?: boolean
}

export interface RadarGroup {
  title: string
  metrics: MetricDef[]
}

export interface RowData {
  key: string
  raw: number | null
  pct: number
  axisLabel: string
  explanation: string
  unit: string
  percKey: string
}

// ─── Metric Keys ─────────────────────────────────────────────────────────────

export const METRIC_KEYS = [
  'maxCogVelocity', 'cogDeceleration', 'strideLength', 'pelvisRotVelo', 'hipShoulderSep',
  'torsoCounterRot', 'torsoForwardTiltFP', 'torsoRotationFP', 'torsoLateralTiltMER',
  'torsoRotationBR', 'trunkRotVelo', 'leadKneeExt', 'kneeExtVelo', 'shoulderAbdFP',
  'elbowFlexionFP', 'scapLoadFP', 'layback', 'shoulderRotVelo', 'elbowExtVelo',
  'shoulderERatFP',
]

// ─── 4 Metric Groups (19 metrics) ───────────────────────────────────────────

export const GROUPS: RadarGroup[] = [
  {
    title: 'Drive & Momentum',
    metrics: [
      { key: 'maxCogVelocity', percKey: 'maxCogVelocity', axisLabel: 'Max COG Velo', unit: 'm/s', explanation: 'How fast you move toward home plate. More momentum = more energy to transfer.' },
      { key: 'cogDeceleration', percKey: 'cogDeceleration', axisLabel: 'COG Decel', unit: 'm/s', explanation: 'How much you slow down from peak to release. More decel = better energy transfer to upper body.' },
      { key: 'strideLength', percKey: 'strideLength', axisLabel: 'Stride Length', unit: 'in', explanation: 'Distance between feet at foot plant. Longer stride = more time to accelerate.' },
      { key: 'pelvisRotVelo', percKey: 'pelvisRotVelo', axisLabel: 'Pelvis Rot. Velo', unit: 'deg/s', explanation: 'How fast your hips rotate. First link in the kinetic chain — drives everything above.' },
    ],
  },
  {
    title: 'Posture & Separation',
    metrics: [
      { key: 'hipShoulderSep', percKey: 'hipShoulderSep', axisLabel: 'Hip-Shoulder Sep. at FP', unit: 'deg', explanation: 'Angle between hips and shoulders at foot plant. More separation = more rotational stretch.' },
      { key: 'torsoCounterRot', percKey: 'torsoCounterRot', axisLabel: 'Peak Torso Counter Rot.', unit: 'deg', explanation: 'Peak torso counter-rotation away from home. Loads the trunk like a coiled spring.', invert: true },
      { key: 'torsoForwardTiltFP', percKey: 'torsoForwardTiltFP', axisLabel: 'Torso Fwd Tilt at FP', unit: 'deg', explanation: 'How much you lean forward at foot plant. Slight forward lean is optimal.' },
      { key: 'torsoLateralTiltMER', percKey: 'torsoLateralTiltMER', axisLabel: 'Torso Side Bend at MER', unit: 'deg', explanation: 'Side bend toward glove side at max layback. Creates the "stacking" position.' },
      { key: 'torsoRotationBR', percKey: 'torsoRotationBR', axisLabel: 'Torso Rotation at BR', unit: 'deg', explanation: 'How far your torso rotated from foot plant to ball release.' },
    ],
  },
  {
    title: 'Block & Velocity',
    metrics: [
      { key: 'leadKneeExt', percKey: 'leadKneeExt', axisLabel: 'Lead Knee Extension', unit: 'deg', explanation: 'How much your lead knee straightens from foot plant to release. More = better energy block.' },
      { key: 'kneeExtVelo', percKey: 'kneeExtVelo', axisLabel: 'Peak Knee Ext. Velo', unit: 'deg/s', explanation: 'How fast your lead knee extends. Faster = more aggressive lead leg block.' },
      { key: 'trunkRotVelo', percKey: 'trunkRotVelo', axisLabel: 'Torso Rot. Velo', unit: 'deg/s', explanation: 'How fast your trunk rotates. Second link in the kinetic chain after the hips.' },
      { key: 'shoulderAbdFP', percKey: 'shoulderAbdFP', axisLabel: 'Shoulder Abd. at FP', unit: 'deg', explanation: 'Arm elevation at foot plant. ~90 degrees means arm is at shoulder height.' },
      { key: 'elbowFlexionFP', percKey: 'elbowFlexionFP', axisLabel: 'Elbow Flexion at FP', unit: 'deg', explanation: 'Elbow bend at foot plant. ~100 degrees means a near right angle.' },
    ],
  },
  {
    title: 'Arm Action',
    metrics: [
      { key: 'scapLoadFP', percKey: 'scapLoadFP', axisLabel: 'Scap Load at FP', unit: 'deg', explanation: 'Shoulder horizontal abduction at foot plant. How far the arm is behind the body — loads the shoulder.' },
      { key: 'shoulderERatFP', percKey: 'shoulderERatFP', axisLabel: 'Shoulder ER at FP', unit: 'deg', explanation: 'Shoulder external rotation at foot plant. How far the arm has cocked back at landing.' },
      { key: 'layback', percKey: 'layback', axisLabel: 'Layback', unit: 'deg', explanation: 'Max external rotation at MER. The "arm cocking" position — more layback = longer acceleration path.' },
      { key: 'shoulderRotVelo', percKey: 'shoulderRotVelo', axisLabel: 'Shoulder IR Velo', unit: 'deg/s', explanation: 'Peak shoulder internal rotation speed. The fastest human movement — directly drives ball speed.' },
      { key: 'elbowExtVelo', percKey: 'elbowExtVelo', axisLabel: 'Elbow Extension Velo', unit: 'deg/s', explanation: 'How fast the elbow extends toward release. Rapid extension helps whip the ball.' },
    ],
  },
]

// ─── Industry Medians (30k+ pitch database, 90+ mph) ────────────────────────

export const INDUSTRY_MEDIAN: Record<string, { value: number; unit: string }> = {
  maxCogVelocity:       { value: 2.85, unit: 'm/s' },
  cogDeceleration:      { value: 1.60, unit: 'm/s' },
  strideLength:         { value: 58, unit: 'in' },
  pelvisRotVelo:        { value: 597, unit: 'deg/s' },
  hipShoulderSep:       { value: 30, unit: 'deg' },
  torsoCounterRot:      { value: -38, unit: 'deg' },
  torsoForwardTiltFP:   { value: 4, unit: 'deg' },
  torsoLateralTiltMER:  { value: 25, unit: 'deg' },
  torsoRotationBR:      { value: 111, unit: 'deg' },
  trunkRotVelo:         { value: 965, unit: 'deg/s' },
  leadKneeExt:          { value: 11, unit: 'deg' },
  kneeExtVelo:          { value: 317, unit: 'deg/s' },
  shoulderAbdFP:        { value: 85, unit: 'deg' },
  elbowFlexionFP:       { value: 102, unit: 'deg' },
  scapLoadFP:           { value: 51, unit: 'deg' },
  layback:              { value: 190, unit: 'deg' },
  shoulderRotVelo:      { value: 4681, unit: 'deg/s' },
  elbowExtVelo:         { value: 2318, unit: 'deg/s' },
}

// ─── Percentile Computation ──────────────────────────────────────────────────

/**
 * Build a percentile lookup table from raw cohort metric rows.
 * For each metric key, collects all values, sorts ascending, and computes
 * percentiles 1-99 using linear interpolation.
 */
export function buildPercentileTable(rows: Record<string, number>[]): PercentileTable {
  const metrics: Record<string, { percentiles: Record<string, number> }> = {}

  for (const key of METRIC_KEYS) {
    const vals = rows
      .map(r => r[key])
      .filter(v => v != null && !isNaN(v))
      .sort((a, b) => a - b)

    if (vals.length < 2) continue

    const n = vals.length
    const percentiles: Record<string, number> = {}

    for (let p = 1; p < 100; p++) {
      const k = (p / 100) * (n - 1)
      const lo = Math.floor(k)
      const hi = Math.min(lo + 1, n - 1)
      percentiles[String(p)] = Math.round((vals[lo] + (k - lo) * (vals[hi] - vals[lo])) * 100) / 100
    }

    metrics[key] = { percentiles }
  }

  return { cohort: '85+', sampleSize: rows.length, metrics }
}

/**
 * Compute the percentile rank for a given value against a percentile lookup.
 * Uses linear interpolation between percentile breakpoints.
 */
export function computePercentile(value: number, percentiles: Record<string, number>): number {
  const pKeys = Object.keys(percentiles).map(Number).sort((a, b) => a - b)

  if (value <= percentiles['1']) return 1
  if (value >= percentiles['99']) return 99

  for (let i = 0; i < pKeys.length - 1; i++) {
    const pLo = pKeys[i]
    const pHi = pKeys[i + 1]
    const vLo = percentiles[String(pLo)]
    const vHi = percentiles[String(pHi)]

    if (value >= vLo && value <= vHi) {
      if (vHi === vLo) return pLo
      return pLo + ((value - vLo) / (vHi - vLo)) * (pHi - pLo)
    }
  }

  return 50
}

/**
 * Get metric percentile data from a PercentileTable.
 */
export function getMetricData(percKey: string, percentileData: PercentileTable | null) {
  if (!percentileData) return undefined
  return percentileData.metrics[percKey]
}

/**
 * Build SVG distribution path from percentile data (KDE gaussian curve).
 * Returns an SVG path string compatible with react-native-svg <Path>.
 */
export function buildDistributionPath(
  percentiles: Record<string, number>,
  width: number = 200,
  height: number = 60
): string {
  const pcts = [1, 3, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97, 99]
  const vals = pcts.map(p => percentiles[String(p)] ?? 0)
  const vMin = vals[0]
  const vMax = vals[vals.length - 1]
  const range = vMax - vMin || 1
  const bandwidth = range * 0.08

  const bins = 80
  const density = new Array(bins).fill(0)
  for (let b = 0; b < bins; b++) {
    const x = vMin + (b / (bins - 1)) * range
    let sum = 0
    for (const v of vals) {
      const z = (x - v) / bandwidth
      sum += Math.exp(-0.5 * z * z)
    }
    density[b] = sum
  }

  const maxD = Math.max(...density, 0.001)

  const points: string[] = []
  for (let b = 0; b < bins; b++) {
    const x = (b / (bins - 1)) * width
    const y = height - (density[b] / maxD) * (height - 6)
    if (b === 0) {
      points.push(`M${x},${y}`)
    } else {
      const prevX = ((b - 1) / (bins - 1)) * width
      const cpX = (prevX + x) / 2
      points.push(`S${cpX},${y} ${x},${y}`)
    }
  }

  return `${points.join(' ')} L${width},${height} L0,${height} Z`
}

/**
 * Compute RowData for a metric group given scalar metrics and percentile data.
 */
export function computeGroupData(
  group: RadarGroup,
  scalarMetrics: Record<string, number>,
  percentileData: PercentileTable | null
): RowData[] {
  return group.metrics.map((m) => {
    const raw = scalarMetrics[m.key] ?? scalarMetrics[m.percKey] ?? null
    const md = getMetricData(m.percKey, percentileData)
    let pct = 50
    if (raw != null && md) {
      pct = computePercentile(raw, md.percentiles)
      if (m.invert) pct = 100 - pct
    }
    return { ...m, raw, pct }
  })
}
