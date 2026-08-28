# Workout Logger × Performance Screen — Full Audit

Date: 2026-05-30. Codebase: `aspboost-mobile` (Expo SDK 54, iOS).

Methodology: 3 parallel code-explorer agents reading the actual TS/SQL — every claim below is grounded with a `file:line` citation. No guesses.

---

## TL;DR

The workout logger writes data correctly to `exercise_logs` and the Performance screen reads from it correctly. **The pipe is connected.** What's missing is everything *around* the pipe — both UX features (rest timer, athlete notes, plate calculator, RPE) and analytics (e1RM, percentile context, hard-hit %, set-by-set trend, force/arm-care summary chips on the main dashboard).

There are also **5 real bugs** in the pipe itself — listed at the top of the gaps section. Two of them silently corrupt data.

The hitting screen and ForceProfile are the most polished surfaces; the main PerformanceScreen is the *weakest* of the bunch despite being the headline. ArmCare is also production-grade in isolation but invisible from the main dashboard.

---

## 1. Bugs that are actively wrong (fix before anything else)

### 1.1 `workout_instances.started_at` does not exist in the schema
- **Write:** `WorkoutLoggerScreen.tsx:506` sets `started_at: new Date().toISOString()`
- **Read:** `WorkoutLoggerScreen.tsx:522` reads `instance.started_at` to restore the elapsed timer
- **Schema:** `databasescheme.md:4984-5008` — column does not exist
- **Effect:** PostgREST silently drops the unknown key on write, and the read always returns `undefined`. **Every resumed workout starts the elapsed timer at 0.**
- **Fix:** add `started_at timestamptz` column via migration, or repurpose `created_at` and document.

### 1.2 `checkAndSavePR` upsert has no `onConflict` clause
- **Location:** `WorkoutLoggerScreen.tsx:769-779`
- **Effect:** every PR beat during a workout creates a *new* row in `athlete_maxes`. Athletes accumulate duplicate PR cards for the same exercise/metric. PerformanceScreen's `fetchMaxes` returns all rows ordered by `achieved_on` — so the UI shows phantom history.
- **Also broken:** writes `workout_instance_id` which isn't a column on `athlete_maxes` (silently dropped), and never writes `source: 'logged'` so the "Auto" badge in `MaxCard` (`PerformanceScreen.tsx:1318`) never renders for mobile-captured PRs.
- **Fix:** add `{ onConflict: 'athlete_id,exercise_id,metric_id,reps_at_max' }` and set `source: 'logged'`.

### 1.3 Stale-closure debounce in `saveSetData` can save data under wrong exercise
- **Location:** `WorkoutLoggerScreen.tsx:834-838` (single `saveTimeout` for the whole session)
- **Effect:** if the athlete enters a value on Exercise A then navigates to Exercise B within 500ms while auto-fill is active, the pending timeout fires with `activeExerciseId = B`. The Exercise A value lands in Exercise B's log. Cross-exercise data contamination.
- **Fix:** key the debounce by exerciseId (a Map of timeouts), or capture the exerciseId in the closure explicitly.

### 1.4 `actual_duration_seconds` and `actual_distance` invisible on CompletedWorkout
- **Location:** `CompletedWorkoutScreen.tsx:145-161` (select) and `:285` (label map)
- **Effect:** the post-workout summary fetches only `actual_reps` and `actual_weight`. Any cardio or timed exercise shows the set as "Completed" with no numbers. Athletes can't review their plank time, sled push distance, etc.
- **Fix:** add `actual_duration_seconds, actual_distance` to the select; extend `formatSetLog()` to render them.

### 1.5 `workoutData` null-deref crash on stale/deleted workout
- **Location:** `WorkoutLoggerScreen.tsx:278-279`
- **Effect:** `if (workoutError) throw workoutError` catches API errors but not `null` data. The next line `workoutData.routines.sort(...)` throws `TypeError` and the screen crashes silently before any user-visible alert.
- **Fix:** `if (!workoutData) throw new Error('Workout not found');` above the sort.

---

## 2. Features that are typed in the schema but don't work

| Feature | Schema/code present | UI state | File:line |
|---|---|---|---|
| AMRAP | `routine.scheme === 'amrap'`, `is_amrap` on `routine_exercise` and `set_configurations` | Falls through to straight-sets, no timer, no "rounds completed" field | `exercise-detail-view.tsx:1366` |
| EMOM | `routine.scheme === 'emom'` typed | Identical to straight-sets, no minute clock | `exercise-detail-view.tsx:1366` |
| Drop sets | — | NOT FOUND | — |
| Rest timer | `rest_seconds` and `rest_between_rounds_seconds` exist | Read-only text display only, no countdown | `block-overview.tsx:405-409` |
| Athlete notes per set | `notes` column on `exercise_logs`, save handler exists, styles exist | TextInput never mounted in JSX — dead code | `exercise-detail-view.tsx:2984-2997` |
| RPE input | `rpe int` column on `exercise_logs` | NOT FOUND in label map or any input | `exercise-detail-view.tsx:229-250` |
| Body weight as variable | `weight` field on `routine_exercise` is text type | Only numeric handling, "BW" / "BW+20" treated as literal | `WorkoutLoggerScreen.tsx:679-746` |
| Hitting norms | `scripts/import-driveline-hittrax-norms.ts` + migration `20260501020000_*.sql` in repo | Never queried — no percentile context | `HittingPerformanceScreen.tsx` |
| Plate calculator | — | NOT FOUND | — |
| e1RM (Epley) | All data available in `exercise_logs` | Not computed anywhere — PRs are only manual or auto-promoted | `PerformanceScreen.tsx` |
| Mocap on PerformanceScreen | `mocap_pitches.r2_uploaded_at IS NOT NULL` | No FAB gate, no widget, completely siloed | `PerformanceScreen.tsx:297-333` |
| Force plate / ArmCare / Mocap summary chips on main dashboard | All have dedicated screens | No "Latest composite: 67th %ile" or "ArmScore 82" on PerformanceScreen | `PerformanceScreen.tsx:565-1170` |

---

## 3. Connection map — does the logger feed Performance correctly?

**Yes for lifting. Mostly.** Trace:

1. Athlete types weight 185 reps 5 → `handleInputChange` updates local state immediately (`WorkoutLoggerScreen.tsx:799`)
2. 500ms debounce → `saveSetData` writes to `exercise_logs` (line 679, columns: `workout_instance_id, routine_exercise_id, exercise_id, athlete_id, set_number, actual_reps, actual_weight, metric_data, notes`)
3. PerformanceScreen `ExercisePerformanceCard` queries `exercise_logs.select('id, workout_instance_id, set_number, actual_reps, actual_weight, metric_data, created_at, workout_instances(completed_at)').eq('athlete_id', X).eq('exercise_id', Y)` (line 1576)
4. Client-side groups by `workout_instance_id`, computes `volume = sum(weight × reps)` per session, renders via custom SVG `LineChart`

**Issues with the read path:**
- Date filter at `PerformanceScreen.tsx:1583` uses `exercise_logs.created_at`, not `workout_instances.completed_at`. Resumed workouts get split across time buckets.
- **No status filter.** In-progress and abandoned workout rows show on the chart mixed with completed sessions — a partial session looks the same as a real one.
- Volume calc requires BOTH `actual_weight` AND `actual_reps`. A weight-only set (e.g., timed isometric) silently disappears from the chart.
- `org_id` is never written by the mobile logger. Every mobile-logged row has `org_id = NULL`. Currently harmless because RLS goes via athlete_id, but it's a hygiene issue.

**Issues with PR detection:**
- Web app uses `set_logs` + `detect_potential_pr()` trigger + `save_set_as_max` RPC. Mobile writes to `exercise_logs` instead → web's PR detection system is entirely bypassed for mobile athletes (see `docs/MAX_TRACKING_SYSTEM.md`).
- Mobile's own `checkAndSavePR` compares against stale local state — if a higher max gets added during the workout from another device, the comparison misses it.

---

## 4. Performance screen — tabs and data

| Tab | Status | Powered by |
|---|---|---|
| Personal Records | Real, works | `athlete_maxes` (join exercises) |
| Exercise History | Real, works | `exercise_logs` (join workout_instances) + `athlete_maxes` per exercise |

Plus FAB-gated nav to: HittingPerformance, PitchingPerformance, ArmCare, ForceProfile, MocapSessions. These are full separate screens — none are surfaced on the main PerformanceScreen as inline widgets.

### Charts inventory
All hand-built SVG via `react-native-svg`. No chart library. The most-used: `LineChart` (`PerformanceScreen.tsx:1842`) and `MultiLineChart` (`:1996`). X-axis labels only render when `points.length <= 7` (`:1948`) — anyone with >7 days of data sees no time axis.

### Critical gaps vs TrainHeroic / WHOOP
1. No pull-to-refresh or `useFocusEffect` on PerformanceScreen (HittingPerformanceScreen has both)
2. No e1RM calculation anywhere
3. No PR sparkline / trend on the PR card itself
4. No "last 5 sessions" inline table per exercise
5. No volume trend (total tonnage per week) chart
6. No percentile / cohort context anywhere except ForceProfile
7. `custom_measurements` query has **no `org_id` filter** (`:265`) — cross-org leak
8. Hard-hit % and barrel rate calculated per session (`HittingPerformanceScreen.tsx:788`) but never displayed
9. Pitching fetches only `rel_speed, spin_rate` — IVB/HB/VAA/spin axis ignored
10. `FlatList` imported but never used — `ScrollView` everywhere, no virtualization

---

## 5. What's already polished — DO NOT break

- **Intensity target system** (set-relative, cross-exercise, wave-load) — `exercise-detail-view.tsx:870-892`
- **Custom numeric keypad** with Next→/Done auto-advance — `components/NumericKeypad.tsx`
- **Superset alternating logic** with progress pills (A1 2/3 · A2 1/3) — `exercise-detail-view.tsx:1602-1649`
- **PR detection banner** with spring animation + tap-for-modal — `exercise-detail-view.tsx:757-774`
- **Notes-only instruction blocks** via `parseInstructionBlock()` — bullet sections + amber callouts
- **Auto-fill green-flash** on inputs — `inputAutoFilled` style class
- **YouTube video** auto-hides when keypad open — clean attention management
- **Blast + HitTrax temporal pairing** (7s window matching, paired-session grouping) — `HittingPerformanceScreen.tsx:604-658` — production-grade
- **Paginated Supabase fetches** to bypass 1000-row limit — both HittingPerformance and PitchingScreen
- **ForceProfile zone vocabulary** (BUILD/SHARPEN/OPTIMIZE/ELITE) — consistent color coding
- **ArmCare** — clinical-quality with zone-banded line charts, "Can I throw today?" card, recovery delta
- **Session card 3px left accent** color-coded by source (HitTrax / FullSwing / Blast / Paired)
- **Reopen Workout** non-destructive flow — all logs preserved, `navigation.replace` so back goes to Dashboard

---

## 6. Visual design system (extracted for reference)

**Colors (consistent across all 7 performance screens):**
- Background: `#0A0A0A` (PerformanceScreen) or `#000000` (HittingPerformance)
- Cards: `rgba(255,255,255,0.05)` bg, `rgba(255,255,255,0.1)` border, radius 12-16
- Primary accent: `#9BDDFF` (sky blue)
- Success / completion: `#10B981` (with `rgba(16,185,129,0.3)` border tints)
- PR / warning: `#FBBF24` (amber) / `#F59E0B`
- Destructive: `#EF4444`
- Cream highlight (HittingPerformance PR value): `#F5F0E6`
- Gold star (HittingPerformance PR icon): `#D4AF37`
- Muted text ladder: `#9CA3AF` → `#737373` → `#525252`

**Source accent strip (3px left bar):**
- HitTrax: `#9BDDFF`
- FullSwing: `#22D3EE`
- Blast+HitTrax paired: `#A78BFA`
- Blast-only: `#6B7280`

**Zone palette (ForceProfile, reusable):**
- ELITE (75+): `#4ADE80`
- OPTIMIZE (50-74): `#9BDDFF`
- SHARPEN (25-49): `#FCD34D`
- BUILD (<25): `#EF4444`

**Typography:**
- Hero PR value: 24px bold
- Card value: 17-20px weight 700-800
- Tile label: 9px uppercase letterSpacing 1
- Section title: 12px weight 700 muted

---

## 7. Ranked roadmap to "$100M app"

| Priority | Fix | Effort |
|---|---|---|
| P0 | Patch the 5 bugs in §1 | 1-2 days |
| P0 | Add `useFocusEffect` + `RefreshControl` to PerformanceScreen | 30 min |
| P0 | Wire athlete notes TextInput (already-built save handler) | 1 hr |
| P1 | Add e1RM badge on PR cards using Epley formula on `exercise_logs` | 4 hrs |
| P1 | Add rest timer countdown with sound/haptics | 1 day |
| P1 | Add "Last 5 sessions" inline mini-table on `ExercisePerformanceCard` | 4 hrs |
| P1 | Render `actual_duration_seconds` / `actual_distance` on CompletedWorkout | 1 hr |
| P1 | Add summary chips on PerformanceScreen for ArmCare / ForceProfile / Mocap | 1 day |
| P2 | Wire hitting norms (schema exists, ingest script exists) to percentile chips | 1 day |
| P2 | Fix LineChart x-axis labels above 7 points | 2 hrs |
| P2 | Add RPE input (10-pt scale) + display on history | 4 hrs |
| P2 | Add plate calculator under the weight input | 4 hrs |
| P2 | Volume trend chart (rolling 8-week total tonnage) | 1 day |
| P3 | True AMRAP/EMOM with timers | 2 days |
| P3 | Pull more Trackman columns (IVB, HB, spin axis, pitch type) into PitchingScreen | 1 day |
| P3 | Add `FlatList` virtualization to high-volume lists | 4 hrs |

**Total to ship the P0+P1 polish: ~5-6 days of focused work.** That gets you to genuine TrainHeroic parity. The mockup at `docs/performance-mockup.html` shows what the post-polish PerformanceScreen looks like.
