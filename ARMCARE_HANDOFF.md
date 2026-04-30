# ArmCare iOS handoff — verify the build works end-to-end

You are taking over an in-progress ArmCare feature inside `aspboost-mobile`.
Everything is supposed to live in iOS — **the web app is being deleted for
this feature**. Do not call `/api/armcare/*`, do not use Bearer headers, do
not assume the web app exists. All reads + writes go directly to Supabase
from the device.

---

## What's already built

### Files added in this repo
- `lib/armcare/ble/activ5-rn.ts` — BLE driver via `react-native-ble-plx`.
  Scans for any device with "activ" in the name, connects to service
  `0xF0F0`, subscribes to char `0xF0FE`, decodes int16 LE × 0.05907 → lbf
  at 10 Hz. Pattern is modeled after `lib/pulse/ble/pulse-device-rn.ts`.
- `lib/armcare/types.ts` — types, rep schedule, position cues, image map,
  timing constants. Image map points at `assets/armcare/{ir,er,scaption,grip}.jpg`.
- `lib/armcare/scoring.ts` — `computeSession()` (math) and
  `toArmcareSessionRow()` (maps the result to the `armcare_sessions`
  column shape).
- `lib/armcare/cues.ts` — beep + haptic cues. `expo-av` plays
  `assets/armcare/sounds/{tick,go,stop}.wav` (synthesized at 880Hz/1320Hz/660Hz).
  `unlockCues()` must be called inside a user gesture (already wired on the
  Connect tap).
- `lib/armcare/zones.ts` — threshold zone helpers + colors. Codifies the
  ArmCare report's page-6 standards. Used by the hub for color-coding.
- `screens/ArmCareHubScreen.tsx` — landing page reached via the "Arm Care"
  card on `PitchingHubScreen`. Hero card with score ring + 4-test peak
  grid, three stat chips (ER:IR / Total / SVR), color legend, View History
  link, sticky-bottom Start Exam button.
- `screens/ArmCareWizardScreen.tsx` — full session capture flow.
- `assets/armcare/{ir,er,scaption,grip}.jpg` — position photos shown on
  each rep's instructions screen.
- `assets/armcare/sounds/{tick,go,stop}.wav` — beep audio.

### Files edited
- `screens/PitchingHubScreen.tsx` — added a third card "Arm Care" (red
  accent, MaterialCommunityIcons "arm-flex") that previews last ArmScore.
- `App.tsx` — registered routes `ArmCareHub` + `ArmCareWizard` in the
  stack. (Existing `ArmCare` route remains — points at the old
  `ArmCareScreen` which still needs to be rebuilt as a proper history page.)

### What's NOT done yet
- **`screens/ArmCareScreen.tsx` (history view) needs to be stripped and
  rebuilt** with the proper layout: threshold zones rendered on every
  metric, trend lines for ArmScore + ER vs IR overlay + Shoulder Balance
  + SVR, recovery-delta cards, optional "Can I throw today?" recommendation.

---

## The wizard flow you need to verify

```
intro                  – "Connect Sensor" red CTA
  ↓ (tap)
connecting             – BLE picker / scan
  ↓
setup                  – pre-filled bodyweight + throwing arm + 1–10 arm-feels
  ↓ (tap "Start Session")
calibrate-prompt       – "Place sensor still" + "Calibrate" button
  ↓ (tap)
calibrate-running      – 2-sec tare
  ↓
rep-instructions       – position photo + cue + "Start" button
  ↓ (tap)             ┐
rep-countdown          │  ♪ ♪ ♪ ♫ (tick·tick·tick·go)
  ↓                   │
rep-push (3 sec)       │  live half-circle gauge + peak watermark + chart
  ↓                   │  ♬ stop beep
rep-result (1.5 sec)   │  big peak number flash
  ↓                   │  ← repeats 8 times (IR_t, IR_nt, ER_t, ER_nt,
                      │     Scap_t, Scap_nt, Grip_t, Grip_nt)
                      │     throwing-arm first within each test
                      ┘
review                 – ArmScore card + per-test asymmetry table
  ↓ (Save)
saving                 – direct Supabase insert into armcare_sessions
  ↓
saved                  – confirmation
```

---

## Sensor protocol (validated 0.9% vs the official ArmCare app)

```
BLE service:  0xF0F0   (full UUID 0000f0f0-0000-1000-8000-00805f9b34fb)
Force char:   0xF0FE   (notify, 2 bytes = int16 LE, 10 Hz)
Battery:      0x180F / 0x2A19  (standard)
Scale:        raw × 0.05907 = lbf
Names:        "ACTIV5-AP-XXXX" or "ActivBody Activ5"
Wake:         sleeps aggressively → squeeze sensor once before scanning
```

---

## Scoring formulas

```
total_strength = max(IR_t, IR_nt) + max(ER_t, ER_nt)
               + max(Scap_t, Scap_nt) + max(Grip_t, Grip_nt)
arm_score      = (total_strength / bodyweight_lbs) × 100      ← whole number
er_ir_ratio    = ER_peak / IR_peak                            ← per side
asymmetry      = |tarm − ntarm| / max(tarm, ntarm) × 100      ← per test
shoulder_balance = mean(asym_ir, asym_er, asym_scap)          ← per session
svr            = total_strength / max_velo_from_trackman
%_of_total     = top_per_test / total_strength                ← sums to 1
```

---

## Threshold zones (from ArmCare report glossary)

```
ArmScore        ≥70 normal · 60–70 watch · <60 warning
Total Strength  ≥70% BW normal · 60–70% watch · <60% warning
ER:IR ratio     0.85–1.05 normal · 0.70–0.84 / 1.06–1.20 watch · <0.70 / >1.20 warning
SVR (15+)       ≥1.6 normal · 1.4–1.6 watch · <1.4 warning
SVR (under 15)  ≥1.3 normal · 1.1–1.3 watch · <1.1 warning
IR / ER peak    ≥20% BW normal · 15–20% watch · <15% warning
Scap / Grip     ≥15% BW normal · 10–15% watch · <10% warning
```

Colors:
- normal `#34D399` (green)
- watch  `#FBBF24` (amber)
- warning `#F87171` (red)
- unknown `#9ca3af` (gray)

---

## Database — `public.armcare_sessions` columns we write

```
athlete_id (uuid, fk athletes.id)
exam_date (date), exam_time (time), exam_type ('direct_capture')
arm_score, total_strength, weight_lbs
velo, svr                                   ← from trackman_pitch_data MAX(rel_speed)
irtarm_max_lbs, irntarm_max_lbs             ← per-rep peaks
ertarm_max_lbs, erntarm_max_lbs
starm_max_lbs, sntarm_max_lbs
gtarm_max_lbs, gntarm_max_lbs
irtarm_strength, ertarm_strength, starm_strength, gtarm_strength
                                            ← tarm aliases (legacy CSV mapping)
shoulder_balance
fresh_arm_feels (text, "1"–"10")
raw_csv_data (jsonb)                        ← full rep payload + samples
```

Many other columns on `armcare_sessions` are CSV-import-only (recovery
status, RS percentages, ROM, etc.) and stay null on direct-capture rows.

---

## Critical setup before testing on device

1. **Dev build, not Expo Go.** `react-native-ble-plx` requires native
   linking. Run `npx expo run:ios` or use the EAS dev client.
2. **`NSBluetoothAlwaysUsageDescription`** must be in `app.json` —
   the existing `@config-plugins/react-native-ble-plx` should wire it
   already (Pulse uses the same plugin).
3. **Wake the sensor** before scanning (squeeze it once). Activ5 sleeps
   hard.
4. **Close the official ArmCare app** before running our wizard. BLE is
   single-connection.
5. **Audio session:** unlock is on the Connect tap — if a user reaches
   later phases without going through Connect, they won't hear beeps. (Not
   currently a real path; the wizard always starts at Connect.)

---

## Things to verify on a real device with a real sensor

1. **Sensor scans + connects.** Wake the sensor, tap Start Exam. Bluetooth
   permission prompt should appear first time. The picker resolves on the
   first device with "activ" in the name.
2. **Battery + name show on Setup screen.** Confirms read of standard
   characteristic + name reflection.
3. **Tare (calibrate) succeeds.** Don't touch the sensor for 2 sec. The
   wizard should advance to the first rep's instructions screen.
4. **All 8 reps produce non-zero peaks.** If any rep saves as `peak=0`,
   the sensor disconnected silently mid-rep — flag that as a bug.
5. **Beeps fire on the 3·2·1 countdown + go + stop.** Even with the iOS
   silent switch on (silent-mode override is set in `cues.ts`).
6. **Haptics fire alongside beeps.** Important for athletes pushing hard
   and not looking at the screen.
7. **Review screen math is sane.** ArmScore should equal
   `total / bodyweight × 100`. ER/IR ratios per side. Asymmetry > 10% gets
   a red flag.
8. **Save actually inserts a row.** After Save, query
   `select * from armcare_sessions where athlete_id = <id> order by
   created_at desc limit 1` — should match the wizard's review.
9. **Velo + SVR populated.** If the athlete has TrackMan data, both
   columns should be non-null. If not, both stay null and the wizard
   doesn't error.
10. **RLS on `armcare_sessions`.** Verify that an athlete can `insert`
    a row for their own `athlete_id`. If RLS blocks it, the insert will
    error in the Save phase. If you need to add a policy:
    ```sql
    -- Allow athletes (and their guardians + coaches) to insert their own
    -- ArmCare sessions. Tighten as needed.
    create policy "athletes can insert their own armcare sessions"
      on public.armcare_sessions for insert to authenticated
      with check (
        exists (
          select 1 from athletes a
          where a.id = athlete_id and a.user_id = auth.uid()
        )
      );
    ```

---

## Known issues / what to fix if it breaks

- **Sensor disconnect mid-rep is silent.** No UI feedback, peak saves as
  0. Add an `onDisconnected` listener on the device that, if it fires
  during `rep-push`, sets `phase = 'error'` with a "sensor lost — retry
  rep" message.
- **Save retry / draft persistence.** If the Supabase insert fails, all
  3 minutes of work is gone. Stash the `SessionResult` in `AsyncStorage`
  before saving so a refresh can recover it.
- **Throwing-arm null fallback.** If `athletes.throws` is empty, the
  Setup screen shows "Not set on profile" but still proceeds — first rep
  is labeled "Throwing Arm" without underlying truth. Block start until
  it's set, OR change the labels to "Side 1 / Side 2" when unknown.
- **Duplicate save.** Disable the Save button while `phase === 'saving'`
  to prevent double-tap.
- **`exam_time` already gets set in `toArmcareSessionRow`** (server-side
  via `new Date().toTimeString()`).

---

## What needs to be built next

`screens/ArmCareScreen.tsx` (the existing history page) should be stripped
and rebuilt from scratch with these sections, top to bottom:

1. **Athlete header** — back button, name, date range selector (30 / 90 /
   180 / All).
2. **"Can I throw today?" card** — single answer (Yes / Reduced / No)
   computed from the most recent session's recovery deltas + zones.
3. **ArmScore trend card** — line chart of last N sessions with the
   threshold band shaded green (>=70) / amber (60–70) / red (<60).
4. **Per-test trend card** — overlay of IR vs ER over time, both shaded
   against their zones.
5. **Shoulder Balance trend** — ER:IR ratio over time, healthy band
   (0.85–1.05) shaded green.
6. **Recovery card** — total strength delta vs previous session +
   per-muscle deltas, color-coded.
7. **Recent history list** — last 10 sessions, compact rows with date +
   ArmScore + zone badge.

Use the same color palette and `borderRadius: 18` cards as the rest of
the app. All trend math comes from `armcare_sessions` rows ordered by
`exam_date DESC`. No new tables or columns needed.

---

## How to test the wizard right now

1. Make sure you're on a dev build (`npx expo run:ios` from this folder).
2. Pair an Activ5 sensor for the first time on the device (charge it,
   squeeze to wake).
3. Sign in as a real athlete account.
4. Tap the Pitching FAB → "Arm Care" card → "Start Exam".
5. Walk through one full session.
6. Confirm the saved row in Supabase Studio (`armcare_sessions` table).

If the BLE picker hangs: kill any other apps that talk to the sensor
(the official ArmCare app especially), squeeze the sensor again, retry.

---

## Notes on what NOT to do

- **Do not call `/api/armcare/*`** — that endpoint exists in the web app
  but the entire web ArmCare feature is being removed. iOS is the only
  surface for this going forward.
- **Do not add a Bearer header anywhere.** The Supabase client carries
  auth automatically.
- **Do not assume the user has TrackMan data.** Velo + SVR are nullable
  and the wizard must succeed without them.
- **Do not commit the `Untitled design/` folder** at the repo root — the
  source photos are already copied into `assets/armcare/`.

When in doubt about behavior, the source of truth is the validated
Python reference at `/Users/maxsmac/Desktop/motus/armcare/`.
