# Hitting Data Sources - Metrics Comparison

## Overview

Three data sources for hitting analytics:
- **Blast Motion** - Bat sensor (swing mechanics only)
- **HitTrax** - Ball tracking (ball flight only)
- **Full Swing** - Combined system (both bat AND ball metrics per swing)

Full Swing is unique because each swing includes BOTH bat speed and exit velocity - no timestamp matching required.

---

## Database Tables

### Blast Motion

**Table: `blast_swings`** (individual swings - no session table)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| athlete_id | UUID | Foreign key to athletes |
| recorded_date | DATE | Session date (YYYY-MM-DD) |
| recorded_time | TIME | Swing time (UTC) |
| created_at_utc | TIMESTAMPTZ | Full timestamp |
| swing_details | TEXT | Type of swing |
| bat_speed | DECIMAL | mph |
| attack_angle | DECIMAL | degrees |
| vertical_bat_angle | DECIMAL | degrees |
| early_connection | DECIMAL | degrees |
| connection_at_impact | DECIMAL | degrees |
| peak_hand_speed | DECIMAL | mph |
| rotational_acceleration | DECIMAL | g's |
| plane_score | DECIMAL | 0-100 |
| connection_score | DECIMAL | 0-100 |
| rotation_score | DECIMAL | 0-100 |
| time_to_contact | DECIMAL | seconds |
| on_plane_efficiency | DECIMAL | percentage |
| power | DECIMAL | kW |

---

### HitTrax

**Table: `hittrax_sessions`** (session aggregates)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| athlete_id | UUID | Foreign key to athletes |
| session_date | TIMESTAMPTZ | Session timestamp |
| total_swings | INTEGER | Swing count |
| avg_exit_velocity | DECIMAL | mph |
| max_exit_velocity | DECIMAL | mph |
| avg_launch_angle | DECIMAL | degrees |
| avg_distance | DECIMAL | feet |
| max_distance | DECIMAL | feet |

**Table: `hittrax_swings`** (individual swings)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| session_id | UUID | Foreign key to sessions |
| swing_number | INTEGER | Order in session |
| swing_timestamp | TIMESTAMPTZ | Swing time |
| exit_velocity | DECIMAL | mph |
| launch_angle | DECIMAL | degrees |
| distance | DECIMAL | feet |
| horizontal_angle | DECIMAL | degrees (spray) |
| result | TEXT | "HR", "1B", "F8", etc. |
| hit_type | TEXT | "FB", "LD", "GB" |
| points | INTEGER | Game points |
| poi_x | DECIMAL | Point of impact X |
| poi_y | DECIMAL | Point of impact Y |
| poi_z | DECIMAL | Point of impact Z |
| pitch_velocity | DECIMAL | mph |
| strike_zone | INTEGER | Zone number |
| spray_chart_x | DECIMAL | Landing X coord |
| spray_chart_z | DECIMAL | Landing Z coord |

---

### Full Swing

**Table: `fullswing_sessions`** (session aggregates)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| athlete_id | UUID | Foreign key to athletes |
| session_date | DATE | Session date |
| total_swings | INTEGER | Total swing count |
| contact_swings | INTEGER | Swings with contact |
| avg_exit_velocity | DECIMAL | mph |
| max_exit_velocity | DECIMAL | mph |
| avg_launch_angle | DECIMAL | degrees |
| avg_distance | DECIMAL | feet |
| max_distance | DECIMAL | feet |
| avg_bat_speed | DECIMAL | mph |
| max_bat_speed | DECIMAL | mph |
| avg_smash_factor | DECIMAL | ratio (EV/BatSpeed) |
| max_smash_factor | DECIMAL | ratio |
| avg_squared_up | DECIMAL | 0-1 scale |
| squared_up_rate | DECIMAL | % swings >= 0.80 |
| hard_hit_count | INTEGER | EV >= 90 mph |
| hard_hit_rate | DECIMAL | percentage |
| environment | TEXT | Session environment |
| mode | TEXT | Training mode |
| pitch_distance | TEXT | Distance setting |

**Table: `fullswing_swings`** (individual swings)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| session_id | UUID | Foreign key to sessions |
| pitch_number | INTEGER | Pitch order |
| swing_date | DATE | Swing date |
| swing_time | TIME | Swing time |
| pitcher_name | TEXT | Pitcher name |
| pitcher_id | TEXT | Pitcher ID |
| pitcher_throws | TEXT | L/R |
| batter_name | TEXT | Batter name |
| batter_id | TEXT | Batter ID |
| batter_side | TEXT | L/R |
| pitch_speed | DECIMAL | mph (RelSpeed) |
| spin_rate | DECIMAL | rpm |
| exit_velocity | DECIMAL | mph (ExitSpeed) |
| launch_angle | DECIMAL | degrees |
| spray_angle | DECIMAL | degrees (Direction) |
| distance | DECIMAL | feet |
| hit_spin_rate | DECIMAL | rpm |
| bat_speed | DECIMAL | mph |
| smash_factor | DECIMAL | ratio |
| pot_smash_factor | DECIMAL | Potential smash factor |
| pot_exit_speed | DECIMAL | Potential exit speed |
| squared_up | DECIMAL | 0-1 scale |
| environment | TEXT | Environment |
| mode | TEXT | Mode |
| level | TEXT | Level |

---

## Metrics Comparison Matrix

| Metric | Blast | HitTrax | Full Swing | Notes |
|--------|:-----:|:-------:|:----------:|-------|
| **Bat Speed** | bat_speed | - | bat_speed | mph |
| **Exit Velocity** | - | exit_velocity | exit_velocity | mph |
| **Launch Angle** | - | launch_angle | launch_angle | degrees |
| **Attack Angle** | attack_angle | - | - | Blast only |
| **Distance** | - | distance | distance | feet |
| **Spray Angle** | - | horizontal_angle | spray_angle | degrees |
| **Spray Chart X** | - | spray_chart_x | *calculated* | Full Swing needs conversion |
| **Spray Chart Z** | - | spray_chart_z | *calculated* | Full Swing needs conversion |
| **Smash Factor** | - | - | smash_factor | Full Swing only (EV/BatSpeed) |
| **Squared Up** | - | - | squared_up | Full Swing only (0-1 quality) |
| **Peak Hand Speed** | peak_hand_speed | - | - | Blast only |
| **Time to Contact** | time_to_contact | - | - | Blast only |
| **Connection @ Impact** | connection_at_impact | - | - | Blast only |
| **Early Connection** | early_connection | - | - | Blast only |
| **Plane Score** | plane_score | - | - | Blast only |
| **Connection Score** | connection_score | - | - | Blast only |
| **Rotation Score** | rotation_score | - | - | Blast only |
| **Pitch Velocity** | - | pitch_velocity | pitch_speed | HitTrax/Full Swing |
| **Hit Result** | - | result | - | HitTrax only |
| **Hit Type** | - | hit_type | - | HitTrax only (FB/LD/GB) |
| **POI (Point of Impact)** | - | poi_x/y/z | - | HitTrax only |

---

## Overlapping Metrics (Can Combine)

These metrics exist in multiple sources and can be combined:

| Metric | Sources | Combine Strategy |
|--------|---------|------------------|
| Bat Speed | Blast + Full Swing | Show both with source indicator |
| Exit Velocity | HitTrax + Full Swing | Show both with source indicator |
| Launch Angle | HitTrax + Full Swing | Show both with source indicator |
| Distance | HitTrax + Full Swing | Show both with source indicator |
| Spray Chart | HitTrax + Full Swing | Convert Full Swing spray_angle to x/z |

---

## Unique Metrics by Source

### Blast Only (Swing Mechanics)
- Attack Angle
- Vertical Bat Angle
- Peak Hand Speed
- Rotational Acceleration
- Time to Contact
- On-Plane Efficiency
- Connection @ Impact
- Early Connection
- Plane/Connection/Rotation Scores
- Power (kW)

### HitTrax Only (Ball Flight)
- Hit Result (HR, 1B, F8, etc.)
- Hit Type (FB, LD, GB)
- Points
- Point of Impact (X/Y/Z)
- Strike Zone

### Full Swing Only (Contact Quality)
- Smash Factor (EV / Bat Speed ratio)
- Squared Up (0-1 quality score)
- Potential Smash Factor
- Potential Exit Speed
- Hard Hit Rate (calculated, EV >= 90 mph)
- Squared Up Rate (calculated, % swings >= 0.80)

---

## Spray Angle Conversion

Full Swing uses `spray_angle` (degrees) + `distance` (feet).
HitTrax uses `spray_chart_x` and `spray_chart_z` (coordinates).

**Conversion Formula:**
```typescript
const convertFullSwingSpray = (swing: FullSwingSwing) => {
  if (swing.spray_angle === null || swing.distance === null) return null;

  const radians = (swing.spray_angle * Math.PI) / 180;
  const spray_chart_x = swing.distance * Math.sin(radians);
  const spray_chart_z = swing.distance * Math.cos(radians);

  return {
    ...swing,
    spray_chart_x,
    spray_chart_z,
    source: 'fullswing'
  };
};
```

---

## Mobile App Integration (aspboost-mobile)

### Current Mobile App Screens

| Screen | File | Current Data Sources | Purpose |
|--------|------|---------------------|---------|
| **HittingPerformanceScreen** | `screens/HittingPerformanceScreen.tsx` | Blast + HitTrax | Overview stats, PRs, session history |
| **HittingTrendsScreen** | `screens/HittingTrendsScreen.tsx` | Blast only | Bat speed, attack angle, connection trends |
| **BattedBallTrendsScreen** | `screens/BattedBallTrendsScreen.tsx` | HitTrax only | Exit velo, spray chart, distance trends |
| **HittingSessionScreen** | `screens/HittingSessionScreen.tsx` | Blast + HitTrax | Detailed session view, paired data |
| **HittingCard** | `components/dashboard/HittingCard.tsx` | Blast + HitTrax | Dashboard card with PRs |

---

### Phase 1: TypeScript Types

Add to your types file (e.g., `lib/types.ts`):

```typescript
interface FullSwingSession {
  id: string;
  athlete_id: string;
  session_date: string;
  total_swings: number;
  contact_swings: number;
  avg_exit_velocity: number | null;
  max_exit_velocity: number | null;
  avg_launch_angle: number | null;
  avg_distance: number | null;
  max_distance: number | null;
  avg_bat_speed: number | null;
  max_bat_speed: number | null;
  avg_smash_factor: number | null;
  max_smash_factor: number | null;
  avg_squared_up: number | null;
  squared_up_rate: number | null;
  hard_hit_count: number;
  hard_hit_rate: number | null;
}

interface FullSwingSwing {
  id: string;
  session_id: string;
  pitch_number: number | null;
  swing_date: string | null;
  swing_time: string | null;
  bat_speed: number | null;
  exit_velocity: number | null;
  launch_angle: number | null;
  spray_angle: number | null;
  distance: number | null;
  smash_factor: number | null;
  squared_up: number | null;
  pitch_speed: number | null;
}
```

---

### Phase 2: Data Fetching Utility

Use your existing `fetchAllPaginated` pattern:

```typescript
// Fetch Full Swing sessions
const fullSwingSessions = await fetchAllPaginated<FullSwingSession>(
  () => supabase.from('fullswing_sessions'),
  'id, athlete_id, session_date, total_swings, contact_swings, avg_exit_velocity, max_exit_velocity, avg_launch_angle, avg_distance, max_distance, avg_bat_speed, max_bat_speed, avg_smash_factor, squared_up_rate, hard_hit_count, hard_hit_rate',
  [{ column: 'athlete_id', value: athleteId }],
  'session_date',
  false // descending
);

// Fetch Full Swing swings for spray chart
const fullSwingSwings = await fetchAllPaginated<FullSwingSwing>(
  () => supabase.from('fullswing_swings'),
  'id, session_id, swing_date, bat_speed, exit_velocity, launch_angle, spray_angle, distance, smash_factor, squared_up',
  [{ column: 'session_id', value: sessionIds, operator: 'in' }],
  'swing_date',
  false
);
```

---

### Phase 3: HittingPerformanceScreen Updates

**File:** `screens/HittingPerformanceScreen.tsx`

**Current:** Shows Blast bat speed PR, HitTrax exit velo PR, session history

**Changes needed:**

1. **Add Full Swing to PR calculations:**
```typescript
// In fetchOverviewStats()
const fullSwingData = await fetchAllPaginated<FullSwingSession>(
  () => supabase.from('fullswing_sessions'),
  'max_bat_speed, max_exit_velocity, max_distance, session_date',
  [{ column: 'athlete_id', value: id }],
  'session_date',
  false
);

// Combine for bat speed PR (Blast + Full Swing)
const allBatSpeeds = [
  ...blastData.map(s => ({ value: s.bat_speed, date: s.recorded_date, source: 'blast' })),
  ...fullSwingData.map(s => ({ value: s.max_bat_speed, date: s.session_date, source: 'fullswing' }))
].filter(s => s.value != null);
const batSpeedPR = allBatSpeeds.reduce((max, s) => s.value > max.value ? s : max, allBatSpeeds[0]);

// Combine for exit velo PR (HitTrax + Full Swing)
const allExitVelos = [
  ...hittraxData.map(s => ({ value: s.max_exit_velocity, date: s.session_date, source: 'hittrax' })),
  ...fullSwingData.map(s => ({ value: s.max_exit_velocity, date: s.session_date, source: 'fullswing' }))
].filter(s => s.value != null);
const exitVeloPR = allExitVelos.reduce((max, s) => s.value > max.value ? s : max, allExitVelos[0]);
```

2. **Add Full Swing sessions to session history:**
```typescript
// In fetchSessions()
const allSessions = [
  ...blastSessions.map(s => ({ ...s, source: 'blast' })),
  ...hittraxSessions.map(s => ({ ...s, source: 'hittrax' })),
  ...fullSwingSessions.map(s => ({
    id: s.id,
    date: s.session_date,
    swingCount: s.total_swings,
    avgBatSpeed: s.avg_bat_speed,
    maxBatSpeed: s.max_bat_speed,
    avgExitVelocity: s.avg_exit_velocity,
    maxExitVelocity: s.max_exit_velocity,
    avgDistance: s.avg_distance,
    maxDistance: s.max_distance,
    hardHitCount: s.hard_hit_count,
    source: 'fullswing'
  }))
].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
```

3. **Add source badge to session list items**

---

### Phase 4: HittingTrendsScreen Updates

**File:** `screens/HittingTrendsScreen.tsx`

**Current:** Blast-only bat speed and attack angle trends

**Changes needed:**

1. **Add Full Swing bat speed data to trend charts:**
```typescript
// In data fetching
const fullSwingSessions = await fetchAllPaginated<FullSwingSession>(
  () => supabase.from('fullswing_sessions'),
  'session_date, avg_bat_speed, max_bat_speed, total_swings',
  [{ column: 'athlete_id', value: athleteId }],
  'session_date',
  true // ascending for time series
);

// Combine for bat speed chart
const batSpeedTrendData = [
  ...blastSessionData.map(s => ({
    date: s.date,
    avgBatSpeed: s.avgBatSpeed,
    maxBatSpeed: s.maxBatSpeed,
    swingCount: s.swingCount,
    source: 'blast'
  })),
  ...fullSwingSessions.map(s => ({
    date: s.session_date,
    avgBatSpeed: s.avg_bat_speed,
    maxBatSpeed: s.max_bat_speed,
    swingCount: s.total_swings,
    source: 'fullswing'
  }))
].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
```

2. **Use different point styles or colors for each source in chart**

---

### Phase 5: BattedBallTrendsScreen Updates

**File:** `screens/BattedBallTrendsScreen.tsx`

**Current:** HitTrax-only exit velo, spray chart, distance

**Changes needed:**

1. **Add Full Swing exit velocity to trend charts:**
```typescript
// Combine for exit velocity chart
const exitVeloTrendData = [
  ...hittraxSessions.map(s => ({
    date: s.session_date,
    avgExitVelo: s.avg_exit_velocity,
    maxExitVelo: s.max_exit_velocity,
    swingCount: s.total_swings,
    source: 'hittrax'
  })),
  ...fullSwingSessions.map(s => ({
    date: s.session_date,
    avgExitVelo: s.avg_exit_velocity,
    maxExitVelo: s.max_exit_velocity,
    swingCount: s.total_swings,
    source: 'fullswing'
  }))
].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
```

2. **Add Full Swing swings to spray chart:**
```typescript
// Convert Full Swing spray_angle to x/z coordinates
const convertFullSwingSpray = (swing: FullSwingSwing) => {
  if (swing.spray_angle === null || swing.distance === null) return null;
  const radians = (swing.spray_angle * Math.PI) / 180;
  return {
    spray_chart_x: swing.distance * Math.sin(radians),
    spray_chart_z: swing.distance * Math.cos(radians),
    exit_velocity: swing.exit_velocity,
    launch_angle: swing.launch_angle,
    distance: swing.distance,
    source: 'fullswing'
  };
};

// Combine spray chart data
const allSprayData = [
  ...hittraxSwings
    .filter(s => s.spray_chart_x != null && s.spray_chart_z != null)
    .map(s => ({ ...s, source: 'hittrax' })),
  ...fullSwingSwings
    .map(convertFullSwingSpray)
    .filter(s => s !== null)
];
```

3. **Same for distance trends and launch angle**

---

### Phase 6: HittingSessionScreen Updates

**File:** `screens/HittingSessionScreen.tsx`

**Current:** Session detail view with HitTrax/Blast/Paired modes

**Changes needed:**

1. **Add Full Swing session type:**
```typescript
type SessionType = 'hittrax' | 'blast' | 'paired' | 'fullswing';
```

2. **When session source is 'fullswing', display:**
   - Bat speed + exit velocity (both available per swing)
   - Smash factor (EV / bat speed ratio)
   - Squared up metric
   - No timestamp matching needed - data is pre-paired

3. **For spray chart, use same conversion formula**

---

### Phase 7: HittingCard Updates

**File:** `components/dashboard/HittingCard.tsx`

**Current:** Shows PRs for bat speed, exit velo, distance

**Changes needed:**

1. **Include Full Swing in PR calculations (same as HittingPerformanceScreen)**
2. **Optionally add source indicator to PR display**

---

### Phase 8: Contact Quality Section (NEW)

Add new section for Full Swing exclusive metrics:

**Option A:** Add to BattedBallTrendsScreen as new tab/section

**Option B:** Create new screen `ContactQualityScreen.tsx`

**Metrics to display:**

1. **Smash Factor Trend**
   - Line chart of avg_smash_factor over time
   - Reference line at 1.2 (good) and 1.4 (elite)

2. **Squared Up Rate Trend**
   - Line chart of squared_up_rate over time
   - Target line at 50%

3. **Hard Hit Rate Trend**
   - Line chart of hard_hit_rate over time
   - Target line at 40%

---

## Summary: Screen-by-Screen Changes

| Screen | Current Sources | Add Full Swing To | Priority |
|--------|----------------|-------------------|----------|
| **HittingPerformanceScreen** | Blast + HitTrax | PR calculations, session history | HIGH |
| **HittingTrendsScreen** | Blast only | Bat speed trend charts | HIGH |
| **BattedBallTrendsScreen** | HitTrax only | Exit velo, spray chart, distance | HIGH |
| **HittingSessionScreen** | Blast + HitTrax | New session type for Full Swing | MEDIUM |
| **HittingCard** | Blast + HitTrax | PR calculations | MEDIUM |
| **NEW: Contact Quality** | - | Smash factor, squared up, hard hit | LOW |

---

## Data Combination Summary

| Metric | Sources to Combine | Mobile Screen |
|--------|-------------------|---------------|
| Bat Speed PR | Blast + Full Swing | HittingPerformanceScreen, HittingCard |
| Bat Speed Trends | Blast + Full Swing | HittingTrendsScreen |
| Exit Velo PR | HitTrax + Full Swing | HittingPerformanceScreen, HittingCard |
| Exit Velo Trends | HitTrax + Full Swing | BattedBallTrendsScreen |
| Distance PR | HitTrax + Full Swing | HittingPerformanceScreen, HittingCard |
| Distance Trends | HitTrax + Full Swing | BattedBallTrendsScreen |
| Spray Chart | HitTrax + Full Swing | BattedBallTrendsScreen, HittingSessionScreen |
| Launch Angle | HitTrax + Full Swing | BattedBallTrendsScreen |
| Session History | All three | HittingPerformanceScreen |
| Smash Factor | Full Swing only | NEW section |
| Squared Up | Full Swing only | NEW section |
| Attack Angle | Blast only | No change |
| Connection | Blast only | No change |
| Hit Result | HitTrax only | No change |
