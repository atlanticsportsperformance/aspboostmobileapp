# Performance Screen - Mobile Implementation Plan

## Overview
The Performance page has **two views** controlled by a toggle:
1. **Personal Records** - View/manage athlete maxes (PRs)
2. **Exercise History** - View exercise performance over time with charts

---

## FILE STRUCTURE

```
screens/
├── PerformanceScreen.tsx          # Main screen with toggle
├── PersonalRecordsView.tsx        # Personal Records tab content (extracted component)
└── ExerciseHistoryView.tsx        # Exercise History tab content (extracted component)

components/
└── performance/
    ├── MaxCard.tsx                # Individual PR card display
    ├── AddMaxModal.tsx            # Modal to add new PR
    ├── EditMaxModal.tsx           # Modal to edit existing PR
    ├── ExercisePerformanceCard.tsx # Exercise card with chart
    ├── VolumeChart.tsx            # Volume line chart (SVG)
    └── MetricsChart.tsx           # Multi-line metrics chart (SVG)
```

---

## VIEW 1: PERSONAL RECORDS

### UI Structure
```
┌─────────────────────────────────────────────────────┐
│ ← Performance                                       │
│   Track your maxes and progress                    │
├─────────────────────────────────────────────────────┤
│  [Personal Records]  [Exercise History]   ← Toggle │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ 🔍 Search exercises...                    [+] │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ● GLOBAL METRICS                                  │
│  ┌───────────────────────────────────────────────┐ │
│  │ 5oz Mound Velocity          [Global] [Auto]  │ │
│  │ 95.2 mph • Sep 15, 2024                      │ │
│  │                          [Edit] [Delete]     │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ● EXERCISE PRs                                    │
│  ┌───────────────────────────────────────────────┐ │
│  │ Dumbbell Bench Press       [Peak Velo] [Auto]│ │
│  │ 25.4 mph • Nov 20, 2024   ✓ Verified         │ │
│  │                    [Verify] [Edit] [Delete]  │ │
│  └───────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────┐ │
│  │ Back Squat                 [Weight]          │ │
│  │ 405 lbs (3 reps) • Oct 30, 2024              │ │
│  │                          [Edit] [Delete]     │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Data Requirements

**Supabase Queries:**
```typescript
// 1. Fetch athlete maxes with exercise names
const { data: maxes } = await supabase
  .from('athlete_maxes')
  .select('*, exercises(name)')
  .eq('athlete_id', athleteId)
  .order('achieved_on', { ascending: false });

// 2. Fetch exercises for dropdown
const { data: exercises } = await supabase
  .from('exercises')
  .select('*')
  .eq('is_active', true)
  .order('name');

// 3. Fetch custom measurements for metric types
const { data: measurements } = await supabase
  .from('custom_measurements')
  .select('*')
  .order('name');
```

### Features to Implement
1. **Search bar** - Filter PRs by exercise name or metric
2. **Add button** (+) - Opens AddMaxModal
3. **Global metrics section** - PRs with `exercise_id = null`
4. **Exercise PRs section** - PRs with specific exercises
5. **Max Card** displays:
   - Exercise name (or "5oz Mound Velocity" for global)
   - Metric type badge (blue)
   - Global badge (purple) if global metric
   - Auto badge (green) if source = "logged"
   - Verified checkmark if verified_by_coach = true
   - Value with unit
   - Reps (if weight metric)
   - Date achieved
   - Notes (truncated)
6. **Action buttons:**
   - Verify (green) - if not verified, coach only
   - Edit - opens EditMaxModal
   - Delete - confirm then delete

### Add Max Modal
```
┌──────────────────────────────────────────────────┐
│ Add Personal Record                        ✕     │
├──────────────────────────────────────────────────┤
│ Metric Type *                                    │
│ [─ Select metric type... ─]                      │
│   • Global: 5oz Mound Velocity (mph)             │
│   • Custom Measurements...                       │
│                                                  │
│ Exercise * (if not global)                       │
│ [─ Select exercise... ─]                         │
│                                                  │
│ Max Value *         Reps (if weight)             │
│ [─────────]         [──]                         │
│                                                  │
│ Date Achieved *                                  │
│ [─ Today ─]                                      │
│                                                  │
│ Notes (optional)                                 │
│ [─────────────────────────────]                  │
│                                                  │
│           [Cancel]  [Add Max]                    │
└──────────────────────────────────────────────────┘
```

### Edit Max Modal
Same as Add but:
- Exercise and Metric fields are read-only
- Pre-populated with existing values
- Submit button says "Save Changes"

---

## VIEW 2: EXERCISE HISTORY

### UI Structure
```
┌─────────────────────────────────────────────────────┐
│ ← Performance                                       │
│   Track your maxes and progress                    │
├─────────────────────────────────────────────────────┤
│  [Personal Records]  [Exercise History]   ← Toggle │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Timeframe: [7D] [30D] [90D] [All]                 │
│                                                     │
│  Category: [All] [Throwing] [Hitting] [S&C] →      │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ 🔍 Search exercises...              [2/10]   │ │
│  └───────────────────────────────────────────────┘ │
│  [Bench Press ✕] [Squat ✕]  ← Selected pills       │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ Dumbbell Bench Press              [S&C]      │ │
│  │ ─────────────────────────────────────────────│ │
│  │ ⭐ Personal Records                          │ │
│  │ Peak Velo: 25.4 mph (3 days ago)             │ │
│  │ Weight: 95 lbs (5 days ago)                  │ │
│  │ ─────────────────────────────────────────────│ │
│  │ [Volume]  [Metrics]   ← Tab toggle           │ │
│  │                                              │ │
│  │    📈 LINE CHART                             │ │
│  │    ╱╲    ╱╲                                  │ │
│  │   ╱  ╲  ╱  ╲                                 │ │
│  │  ╱    ╲╱    ╲                                │ │
│  │ ────────────────────                         │ │
│  │ Sep 1   10    20   Oct 1                     │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ Back Squat                        [S&C]      │ │
│  │ ... (same structure)                         │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Data Requirements

**Supabase Queries:**
```typescript
// 1. Get exercises athlete has logged
const { data: loggedExercises } = await supabase
  .from('exercise_logs')
  .select('exercise_id, exercises(id, name, categories)')
  .eq('athlete_id', athleteId);

// 2. Get exercise logs for selected exercise
const { data: logs } = await supabase
  .from('exercise_logs')
  .select(`
    id, workout_instance_id, set_number,
    actual_reps, actual_weight, metric_data, created_at,
    workout_instances(completed_at)
  `)
  .eq('athlete_id', athleteId)
  .eq('exercise_id', exerciseId)
  .gte('created_at', dateFilter)
  .order('created_at', { ascending: true });

// 3. Get PRs for exercise
const { data: prs } = await supabase
  .from('athlete_maxes')
  .select('metric_id, max_value, achieved_on')
  .eq('athlete_id', athleteId)
  .eq('exercise_id', exerciseId);
```

### Features to Implement
1. **Timeframe selector** - 7D, 30D, 90D, All (buttons)
2. **Category filter** - Horizontal scroll tabs (All, Throwing, Hitting, S&C)
3. **Exercise search dropdown** - Multi-select up to 10
4. **Selected exercises pills** - Show selected with X to remove
5. **Exercise Performance Card:**
   - Exercise name + category badge
   - PR section (yellow bg) if PRs exist
   - Volume/Metrics tab toggle (if applicable)
   - Volume Chart (amber line) - weight × reps per session
   - Metrics Chart (multi-line) - each metric gets unique color

### Chart Implementation (react-native-svg)

**Volume Chart:**
```typescript
// Single line chart
// X-axis: Session dates
// Y-axis: Total volume (lbs)
// Line color: #f59e0b (amber)
```

**Metrics Chart:**
```typescript
// Multi-line chart
// X-axis: Session dates
// Y-axis: Metric values (dynamic domain)
// Line colors: Based on metric name patterns
// Legend: Show metric names with colors
```

---

## COLOR SCHEME

| Element | Color |
|---------|-------|
| Background | #0A0A0A |
| Card background | rgba(255,255,255,0.05) |
| Primary accent | #9BDDFF |
| Blue button | #3B82F6 |
| Toggle active | #9BDDFF + text-black |
| Toggle inactive | rgba(255,255,255,0.1) |
| Blue badge | rgba(59,130,246,0.2) + #93C5FD |
| Purple badge | rgba(139,92,246,0.2) + #C4B5FD |
| Green badge | rgba(34,197,94,0.2) + #86EFAC |
| Yellow/PR bg | rgba(245,158,11,0.1) + border rgba(245,158,11,0.2) |
| Volume line | #F59E0B (amber) |
| Metrics lines | Dynamic based on metric name |
| Delete | #EF4444 |
| Verified | #4ADE80 |

---

## IMPLEMENTATION STEPS

### Phase 1: Basic Structure
1. Create PerformanceScreen.tsx with header and toggle
2. Implement toggle state (personalRecords vs exerciseHistory)
3. Add placeholder views for each tab

### Phase 2: Personal Records View
1. Implement MaxCard component
2. Fetch and display athlete_maxes
3. Add search filtering
4. Separate global vs exercise PRs sections
5. Add empty state

### Phase 3: Add/Edit Max Modals
1. Create AddMaxModal with form
2. Implement metric type dropdown (global + custom)
3. Implement exercise dropdown (conditional)
4. Handle form submission (insert/upsert)
5. Create EditMaxModal (read-only exercise/metric)
6. Implement delete with confirmation

### Phase 4: Exercise History View
1. Implement timeframe selector
2. Implement category filter tabs
3. Implement exercise search/multi-select dropdown
4. Display selected pills
5. Add empty states

### Phase 5: Exercise Performance Card
1. Create card layout with exercise name + category
2. Display PR section (yellow box)
3. Implement Volume/Metrics tab toggle
4. Create placeholder for charts

### Phase 6: Charts (react-native-svg)
1. Implement VolumeChart (single amber line)
2. Implement MetricsChart (multi-line with colors)
3. Add axis labels and grid
4. Handle touch interactions for tooltips

### Phase 7: Polish & Integration
1. Add FAB button matching other screens
2. Test all CRUD operations
3. Handle loading and error states
4. Add to App.tsx navigation
5. Update MOBILE_APP_PROGRESS.md

---

## ESTIMATED COMPLEXITY

| Component | Complexity | Notes |
|-----------|------------|-------|
| PerformanceScreen | Medium | Toggle, header, navigation |
| PersonalRecordsView | Medium | List, search, sections |
| MaxCard | Low | Display component |
| AddMaxModal | High | Form, dropdowns, validation |
| EditMaxModal | Medium | Similar to Add |
| ExerciseHistoryView | High | Multi-select, filters, categories |
| ExercisePerformanceCard | Medium | Tabs, PR display |
| VolumeChart | High | SVG line chart |
| MetricsChart | Very High | Multi-line SVG chart with legend |

---

## NOTES

- Use react-native-svg for all chart rendering (no web recharts)
- Charts should be touch-interactive (show value on tap)
- All Supabase queries direct (no API routes)
- Match DashboardScreen FAB pattern exactly
- Use existing zone colors where applicable
- Handle keyboard for search inputs (KeyboardAvoidingView)
