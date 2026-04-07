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
  /** Detailed description for the tooltip modal */
  detail: string
  /** Biomechanical event timing context (e.g. "at Foot Plant", "at Max External Rotation") */
  timing?: string
  unit: string
  invert?: boolean
  /** 'higher' = more is better (score = percentile), 'goldilocks' = closer to p50 is better */
  scoring: 'higher' | 'goldilocks'
}

export interface RadarGroup {
  title: string
  metrics: MetricDef[]
}

export interface RowData {
  key: string
  raw: number | null
  score: number
  pct: number
  axisLabel: string
  explanation: string
  detail: string
  timing?: string
  scoring: 'higher' | 'goldilocks'
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
      { key: 'maxCogVelocity', percKey: 'maxCogVelocity', axisLabel: 'Max COG Velo', unit: 'm/s', scoring: 'higher',
        explanation: 'How fast you move toward home plate. More momentum = more energy to transfer.',
        detail: 'Center of Gravity (COG) velocity measures how fast your entire body moves toward home plate during the stride phase. This is the engine of your delivery — the linear momentum you build during your stride gets converted into rotational energy at foot plant. Elite pitchers generate more COG velocity because they push harder off the rubber and maintain an aggressive move down the mound. Higher COG velocity is strongly correlated with pitch speed.',
        timing: 'Peak during stride phase' },
      { key: 'cogDeceleration', percKey: 'cogDeceleration', axisLabel: 'COG Decel', unit: 'm/s', scoring: 'higher',
        explanation: 'How much you slow down from peak to release. More decel = better energy transfer to upper body.',
        detail: 'COG deceleration measures how effectively you transfer momentum from your lower half to your upper body. When your lead foot plants and your body decelerates, that energy has to go somewhere — it transfers up the kinetic chain into trunk rotation and arm speed. More deceleration means you\'re "braking" harder with your lead side, which creates a whip effect that accelerates the arm. Think of it like cracking a whip — the handle stops, the tip accelerates.',
        timing: 'Foot plant through ball release' },
      { key: 'strideLength', percKey: 'strideLength', axisLabel: 'Stride Length', unit: 'in', scoring: 'goldilocks',
        explanation: 'Distance between feet at foot plant. Too short = no momentum, too long = hard to stabilize.',
        detail: 'Stride length is the distance between your back foot on the rubber and your lead foot at foot plant, typically expressed in inches or as a percentage of body height. A longer stride gives you more time to accelerate and more distance to build momentum, but going too long can cause you to "fall off" and lose control of your body at foot plant. Most elite pitchers stride between 77-85% of their body height. The optimal stride length is individual — it depends on your leg length, flexibility, and ability to stabilize at landing.',
        timing: 'Measured at foot plant' },
      { key: 'pelvisRotVelo', percKey: 'pelvisRotVelo', axisLabel: 'Pelvis Rot. Velo', unit: 'deg/s', scoring: 'higher',
        explanation: 'How fast your hips rotate. First link in the kinetic chain — drives everything above.',
        detail: 'Pelvis rotational velocity is how fast your hips rotate from the stride toward home plate. The pelvis is the first major rotational segment in the kinetic chain — it fires before the torso, which fires before the arm. Faster hip rotation creates more separation between the hips and shoulders (hip-shoulder separation), which loads the trunk like a coiled spring. Elite pitchers generate significantly higher pelvis rotation speeds, which is a foundation for generating velocity up the chain.',
        timing: 'Peak during rotation phase' },
    ],
  },
  {
    title: 'Posture & Separation',
    metrics: [
      { key: 'hipShoulderSep', percKey: 'hipShoulderSep', axisLabel: 'Hip-Shoulder Sep. at FP', unit: 'deg', scoring: 'higher',
        explanation: 'Angle between hips and shoulders at foot plant. More separation = more rotational stretch.',
        detail: 'Hip-shoulder separation is the angular difference between where your hips are pointing and where your shoulders are pointing at the moment of foot plant. Your hips should already be rotating toward home while your shoulders stay closed (pointing toward third base for a right-hander). This creates a stretch-shortening cycle in your trunk muscles — like pulling back a rubber band. More separation means more stored elastic energy that gets released as trunk rotation velocity. It\'s one of the strongest predictors of pitch velocity.',
        timing: 'Measured at foot plant (FP)' },
      { key: 'torsoCounterRot', percKey: 'torsoCounterRot', axisLabel: 'Peak Torso Counter Rot.', unit: 'deg', scoring: 'goldilocks', invert: true,
        explanation: 'Peak torso counter-rotation away from home. Loads the trunk like a coiled spring.',
        detail: 'Torso counter-rotation measures how far your upper body rotates AWAY from home plate during the stride. This is the "loading" phase — your hips lead forward while your torso stays back or even turns slightly toward second base. More counter-rotation creates a greater stretch across the trunk, loading the obliques and core muscles. However, too much counter-rotation can cause timing issues and make it harder to sequence properly. The optimal amount is individual and depends on your mobility and timing patterns.',
        timing: 'Peak during stride phase' },
      { key: 'torsoForwardTiltFP', percKey: 'torsoForwardTiltFP', axisLabel: 'Torso Fwd Tilt at FP', unit: 'deg', scoring: 'goldilocks',
        explanation: 'How much you lean forward at foot plant. Slight forward lean is optimal.',
        detail: 'Torso forward tilt measures how much your upper body leans toward home plate at the moment of foot plant. A slight forward lean is typical and helps maintain momentum, but too much forward lean at this stage means you\'re "rushing" — your body is out ahead of your arm, which can reduce velocity and control. Too upright can indicate you\'re not using your lower half effectively. The goal is a balanced, athletic position at landing that sets up efficient trunk rotation.',
        timing: 'Measured at foot plant (FP)' },
      { key: 'torsoLateralTiltMER', percKey: 'torsoLateralTiltMER', axisLabel: 'Torso Side Bend at MER', unit: 'deg', scoring: 'goldilocks',
        explanation: 'Side bend toward glove side at max layback. Creates the "stacking" position.',
        detail: 'Torso lateral tilt at max external rotation measures how much you\'re leaning to your glove side when your arm reaches its maximum layback position. This "stacking" or "side bend" helps the arm work on a steeper plane and is associated with higher perceived velocity and better downward movement on pitches. However, excessive lateral tilt puts added stress on the spine and shoulder. The optimal amount allows you to work downhill without compromising your posture or health.',
        timing: 'Measured at max external rotation (MER)' },
      { key: 'torsoRotationBR', percKey: 'torsoRotationBR', axisLabel: 'Torso Rotation at BR', unit: 'deg', scoring: 'goldilocks',
        explanation: 'How far your torso rotated from foot plant to ball release.',
        detail: 'Torso rotation at ball release measures the total rotational displacement of your trunk from foot plant through release. This tells you how much rotational range of motion you\'re using to accelerate the ball. Too little rotation means you\'re not fully utilizing your trunk, leaving velocity on the table. Too much can mean you\'re "flying open" — rotating past the optimal release window, which hurts both velocity and command. The elite range represents efficient use of trunk rotation.',
        timing: 'Measured at ball release (BR)' },
    ],
  },
  {
    title: 'Block & Velocity',
    metrics: [
      { key: 'leadKneeExt', percKey: 'leadKneeExt', axisLabel: 'Lead Knee Extension', unit: 'deg', scoring: 'higher',
        explanation: 'How much your lead knee straightens from foot plant to release. More = better energy block.',
        detail: 'Lead knee extension measures how much your front knee straightens from foot plant through ball release. When your lead leg "blocks" by extending and firming up, it creates a rigid post that your body rotates around. This blocking action converts linear momentum into rotational velocity — like a pole vaulter planting the pole. More knee extension means a firmer block, which transfers more energy up the chain into trunk and arm speed. A soft or collapsing lead leg leaks energy and reduces velocity.',
        timing: 'Foot plant through ball release' },
      { key: 'kneeExtVelo', percKey: 'kneeExtVelo', axisLabel: 'Peak Knee Ext. Velo', unit: 'deg/s', scoring: 'higher',
        explanation: 'How fast your lead knee extends. Faster = more aggressive lead leg block.',
        detail: 'Peak knee extension velocity measures how FAST your lead knee straightens, not just how far. A rapid extension means you\'re aggressively blocking with your lead side, creating a more violent deceleration of your lower body. This aggressive block is what separates high-velocity pitchers from low-velocity ones — they don\'t just extend the knee, they snap it into extension quickly, creating a sharp whip effect that accelerates the trunk and arm.',
        timing: 'Peak during rotation phase' },
      { key: 'trunkRotVelo', percKey: 'trunkRotVelo', axisLabel: 'Torso Rot. Velo', unit: 'deg/s', scoring: 'higher',
        explanation: 'How fast your trunk rotates. Second link in the kinetic chain after the hips.',
        detail: 'Trunk rotational velocity is the peak speed of your torso rotation during the delivery. After the hips fire and the lead leg blocks, energy transfers into the trunk which rotates at extremely high speeds. The trunk is the second major link in the kinetic chain — it receives energy from the hips/legs and transfers it to the throwing arm. Higher trunk rotation velocity directly contributes to arm speed and pitch velocity. It\'s the bridge between your lower half and your arm.',
        timing: 'Peak during rotation phase' },
      { key: 'shoulderAbdFP', percKey: 'shoulderAbdFP', axisLabel: 'Shoulder Abd. at FP', unit: 'deg', scoring: 'goldilocks',
        explanation: 'Arm elevation at foot plant. ~90 degrees means arm is at shoulder height.',
        detail: 'Shoulder abduction at foot plant measures how high your throwing arm is relative to your torso at the moment your lead foot hits the ground. Around 90 degrees means your arm is at shoulder height — the most biomechanically efficient position. Too low (arm dragging) means your arm is late and has to catch up, which stresses the shoulder. Too high means you\'re "reaching" and may lose command. Consistent arm position at foot plant is a key indicator of repeatable mechanics.',
        timing: 'Measured at foot plant (FP)' },
      { key: 'elbowFlexionFP', percKey: 'elbowFlexionFP', axisLabel: 'Elbow Flexion at FP', unit: 'deg', scoring: 'goldilocks',
        explanation: 'Elbow bend at foot plant. ~100 degrees means a near right angle.',
        detail: 'Elbow flexion at foot plant measures the bend in your throwing elbow when your lead foot lands. Around 90-100 degrees (a right angle) is typical for elite pitchers. A more extended elbow (straighter arm) at foot plant can indicate the arm is early in its path, while a more flexed elbow (tighter bend) may mean the arm is late. The elbow angle at foot plant sets up the arm\'s acceleration path — the right amount of bend allows for efficient external rotation and layback.',
        timing: 'Measured at foot plant (FP)' },
    ],
  },
  {
    title: 'Arm Action',
    metrics: [
      { key: 'scapLoadFP', percKey: 'scapLoadFP', axisLabel: 'Scap Load at FP', unit: 'deg', scoring: 'goldilocks',
        explanation: 'Shoulder horizontal abduction at foot plant. How far the arm is behind the body.',
        detail: 'Scapular loading (shoulder horizontal abduction) at foot plant measures how far your throwing arm is behind your body when your lead foot lands. This "scap load" stretches the pectoral muscles and anterior shoulder, storing elastic energy that gets released during the acceleration phase. Some loading is beneficial — it creates a stretch-shortening cycle that contributes to arm speed. However, excessive scap load puts significant stress on the anterior shoulder and can lead to injury over time.',
        timing: 'Measured at foot plant (FP)' },
      { key: 'shoulderERatFP', percKey: 'shoulderERatFP', axisLabel: 'Shoulder ER at FP', unit: 'deg', scoring: 'goldilocks',
        explanation: 'Shoulder external rotation at foot plant. How far the arm has cocked back at landing.',
        detail: 'Shoulder external rotation at foot plant measures how much your arm has "cocked" back at the moment of landing. Some external rotation at foot plant is normal and expected, but too much means your arm is already in its layback position before your trunk has started rotating — this is an "early arm" pattern that can reduce velocity and increase shoulder stress. Too little ER at foot plant may indicate the arm is late. The optimal amount allows the arm to smoothly transition into layback as the trunk rotates.',
        timing: 'Measured at foot plant (FP)' },
      { key: 'layback', percKey: 'layback', axisLabel: 'Layback', unit: 'deg', scoring: 'higher',
        explanation: 'Max external rotation at MER. More layback = longer acceleration path.',
        detail: 'Layback (maximum shoulder external rotation) is the furthest point your arm reaches behind your body during the "cocking" phase. This is the position of peak elastic energy storage — your arm is fully laid back like a drawn bow. More layback provides a longer acceleration path for the arm, which gives you more distance to accelerate the ball before release. Layback is one of the strongest correlates of pitch velocity. It\'s largely influenced by shoulder mobility, trunk rotation speed, and timing of the kinetic chain.',
        timing: 'Measured at max external rotation (MER)' },
      { key: 'shoulderRotVelo', percKey: 'shoulderRotVelo', axisLabel: 'Shoulder IR Velo', unit: 'deg/s', scoring: 'higher',
        explanation: 'Peak shoulder internal rotation speed. The fastest human movement — directly drives ball speed.',
        detail: 'Shoulder internal rotation velocity is the fastest movement in all of human sports — elite pitchers exceed 7,000 degrees per second. This is the peak speed at which your arm rotates from layback to release. It\'s the final and most violent link in the kinetic chain. Shoulder IR velocity is a direct determinant of pitch speed — the faster your arm rotates through the release zone, the faster the ball comes out. It\'s heavily influenced by everything below it in the chain: hip speed, trunk speed, lead leg block, and layback.',
        timing: 'Peak during arm acceleration' },
      { key: 'elbowExtVelo', percKey: 'elbowExtVelo', axisLabel: 'Elbow Extension Velo', unit: 'deg/s', scoring: 'higher',
        explanation: 'How fast the elbow extends toward release. Rapid extension helps whip the ball.',
        detail: 'Elbow extension velocity measures how fast your elbow straightens during the acceleration phase. As the shoulder internally rotates, the elbow rapidly extends — these two actions together create the "whip" effect that accelerates the hand and ball. Faster elbow extension contributes directly to ball velocity. It\'s a combination of active muscle contraction and passive centrifugal forces created by the rapidly rotating shoulder. Elite pitchers have significantly faster elbow extension speeds.',
        timing: 'Peak during arm acceleration' },
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
 * Compute a composite score for a metric based on its scoring type.
 *
 * - 'higher': score = percentile (higher percentile = better)
 * - 'goldilocks': score = 100 - 2 * |percentile - 50| (closer to p50 = better)
 *   p50 → 100, p25/p75 → 50, p1/p99 → 2
 */
export function computeScore(pct: number, scoring: 'higher' | 'goldilocks'): number {
  if (scoring === 'higher') {
    return pct
  }
  // Goldilocks: symmetric penalty for distance from p50
  return Math.max(0, 100 - 2 * Math.abs(pct - 50))
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
    const score = computeScore(pct, m.scoring)
    return { ...m, raw, pct, score }
  })
}
