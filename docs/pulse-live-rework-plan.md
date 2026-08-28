# Pulse Live Workload Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Get Pulse live tracking out of the trapped setup modal: the modal becomes setup-only (connect → choose), Start Live drops you onto an on-screen live experience with a sticky LIVE/Stop bar and a manageable throws feed (swipe-delete + undo + restore), arm speed displays in RPM, and a Discard action can wipe the sensor without saving.

**Architecture:** Reuses the existing `PulseProvider` context + `ThrowingWorkloadMonitor` (already tracks live in-screen) + `ThrowingThrowsFeed` (already soft-deletes). Changes: (1) `PulseWizardModal` collapses to connect→choose and closes on Start Live; (2) a new `PulseLiveBar` sticky component reads live state from context and renders LIVE·count·Stop; (3) the feed gains swipe-delete, an undo snackbar, and a Show-deleted/Restore path; (4) the device gains a standalone `clearFlash()` (BLE `0x04`) surfaced as a "Discard" action; (5) arm speed renders as RPM (`dps / 6`).

**Tech Stack:** React Native + Expo, TypeScript, react-native-ble-plx, Supabase, react-native-gesture-handler (Swipeable), Jest (ts-jest, node-only — UI verified manually).

**Working dir:** `/Users/maxsmac/Desktop/aspboostapp/aspboost-mobile`. All commits are local (the app runs via `npx expo start`; no Vercel/build needed). Verify each task with `npx tsc --noEmit` + `npx jest` + a simulator pass.

---

## File Structure

**New files**
- `lib/pulse/units.ts` — pure unit helpers (`dpsToRpm`)
- `components/pulse/PulseLiveBar.tsx` — sticky LIVE·count·Stop bar (reads PulseProvider context)
- `__tests__/pulse-units.test.ts` — unit tests for `dpsToRpm`

**Modified files**
- `components/pulse/ThrowingThrowsFeed.tsx` — RPM display; swipe-delete + undo; Show-deleted/Restore
- `components/pulse/PulseWizardModal.tsx` — RPM in live "Last:" line; Start Live closes modal; Discard action in ChooseStep
- `lib/pulse/ble/pulse-device-rn.ts` — add `clearFlash()` (standalone `0x04`)
- `lib/pulse/ble/hooks.ts` — add `discardSensor()` to `usePulseSync`
- `lib/pulse/PulseProvider.tsx` — expose `discardSensor` if it proxies sync API (verify)
- `screens/WorkoutLoggerScreen.tsx` — mount `PulseLiveBar` in the PulseProvider tree
- `screens/WorkloadScreen.tsx` — mount `PulseLiveBar` in the PulseProvider tree

---

## Task 1: Arm speed → RPM (display)

**Files:**
- Create: `lib/pulse/units.ts`
- Create test: `__tests__/pulse-units.test.ts`
- Modify: `components/pulse/ThrowingThrowsFeed.tsx:327-329`
- Modify: `components/pulse/PulseWizardModal.tsx:899`

> The decoder is correct; only the display unit is wrong. `arm_speed_dps` (°/s) ÷ 6 = RPM, the unit the Pulse iOS app shows. MPH is NOT correct (arm speed is rotational; no linear velocity is computed).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/pulse-units.test.ts
import { dpsToRpm } from '../lib/pulse/units';

describe('dpsToRpm', () => {
  it('converts degrees/sec to revolutions/min (÷6)', () => {
    expect(dpsToRpm(6130)).toBe(1022);   // 6130/6 = 1021.67 → 1022
    expect(dpsToRpm(1484)).toBe(247);
    expect(dpsToRpm(0)).toBe(0);
  });
  it('returns null for null input', () => {
    expect(dpsToRpm(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx jest __tests__/pulse-units.test.ts`
Expected: FAIL — cannot find module `../lib/pulse/units`.

- [ ] **Step 3: Implement**

```typescript
// lib/pulse/units.ts
/** Arm speed: the decoder stores degrees/sec; the Pulse iOS app displays RPM.
 *  360°/rev × 60 s/min → rpm = dps / 6. */
export function dpsToRpm(dps: number | null): number | null {
  if (dps == null) return null;
  return Math.round(dps / 6);
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx jest __tests__/pulse-units.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Use it in the feed row**

In `components/pulse/ThrowingThrowsFeed.tsx`, add `import { dpsToRpm } from '../../lib/pulse/units';` near the top, then replace lines 327-329:

```tsx
        <Text style={styles.rowNumMid}>
          {t.arm_speed_dps != null ? dpsToRpm(t.arm_speed_dps) : '—'}
        </Text>
        <Text style={styles.rowUnit}>RPM</Text>
```

- [ ] **Step 6: Use it in the live "Last:" line**

In `components/pulse/PulseWizardModal.tsx`, add `import { dpsToRpm } from '../../lib/pulse/units';` (both pulse components sit in `components/pulse/`, so `../../` reaches the repo root), then replace line 899:

```tsx
          {lastThrow.armSpeedDps != null ? `  ·  ${dpsToRpm(lastThrow.armSpeedDps)} RPM` : ''}
```

- [ ] **Step 7: Verify + commit**

Run: `npx tsc --noEmit` (expect clean) and re-run jest.

```bash
git add lib/pulse/units.ts __tests__/pulse-units.test.ts components/pulse/ThrowingThrowsFeed.tsx components/pulse/PulseWizardModal.tsx
git commit -m "fix(pulse): display arm speed in RPM (dps/6), not degrees/sec"
```

---

## Task 2: Device `clearFlash()` — wipe sensor without committing

**Files:**
- Modify: `lib/pulse/ble/pulse-device-rn.ts` (next to `wipeFlashAfterSync`, ~line 252)

> The protocol's `0x04` written ALONE (no preceding `0x07`/`0x01`) wipes ALL flash. `wipeFlashAfterSync()` already does `writeCmd(0x04)` post-commit; `clearFlash()` is the same opcode for the explicit "discard" path. Same impl, different intent + name.

- [ ] **Step 1: Add the method**

After `wipeFlashAfterSync()` in `pulse-device-rn.ts`:

```typescript
  /** Destructive: wipe ALL throws from the sensor flash WITHOUT syncing them.
   *  Writes 0x04 standalone (POP_OR_ADVANCE with no preceding 0x07 = full wipe).
   *  Used by the "Discard / Clear sensor" action for leftover throws we don't
   *  want to save (e.g. a previous athlete's session still on the device). */
  async clearFlash(): Promise<void> {
    await this.writeCmd(0x04);
  }
```

- [ ] **Step 2: Verify compile + commit**

```bash
npx tsc --noEmit
git add lib/pulse/ble/pulse-device-rn.ts
git commit -m "feat(pulse): clearFlash() — wipe sensor without committing"
```

---

## Task 3: `discardSensor()` action in usePulseSync

**Files:**
- Modify: `lib/pulse/ble/hooks.ts` (in `usePulseSync`, near `discard` ~line 339)
- Verify/expose in `lib/pulse/PulseProvider.tsx` if it re-exports the sync API.

> `discard()` only clears local React state. `discardSensor()` also wipes the sensor flash (Task 2) and refreshes the cached counter, so the "N cached" badge resets to 0 and those throws never reach the DB.

- [ ] **Step 1: Add the action**

In `usePulseSync` (hooks.ts), alongside `discard`:

```typescript
  const discardSensor = useCallback(async () => {
    try {
      await device?.clearFlash();
    } catch (err) {
      console.warn('[pulse] clearFlash failed', err);
      throw err;
    }
    // Drop any locally-previewed throws + reset status; the sensor counter
    // refreshes via the device's counter subscription after the wipe.
    discard();
  }, [device, discard]);
```

Add `discardSensor` to the object `usePulseSync` returns (find the `return { ... }` and include it).

- [ ] **Step 2: Confirm PulseProvider surfaces it**

Open `lib/pulse/PulseProvider.tsx`. If it spreads/forwards the `usePulseSync` result into context (e.g. `sync.discardSensor`), no change needed. If it hand-picks fields, add `discardSensor` to the forwarded set. (Search for `discard` in PulseProvider to match the existing pattern.)

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit
git add lib/pulse/ble/hooks.ts lib/pulse/PulseProvider.tsx
git commit -m "feat(pulse): discardSensor() — clear flash + reset without DB write"
```

---

## Task 4: Discard action in the wizard ChooseStep

**Files:**
- Modify: `components/pulse/PulseWizardModal.tsx` (ChooseStep ~line 701, + the parent passes a handler)

> Adds a destructive "Discard N throws on sensor" affordance below the Start Live / Sync row. Confirms first.

- [ ] **Step 1: Add a handler in the modal component**

In the `PulseWizardModal` component body (where `handleSyncOnly` / `handleStartLive` live), add:

```tsx
  const handleDiscard = useCallback(() => {
    const n = dev.counter ?? 0;
    Alert.alert(
      n > 0 ? `Discard ${n} throw${n === 1 ? '' : 's'}?` : 'Clear sensor?',
      "These were recorded on the sensor and will be wiped WITHOUT being saved to this athlete. Use this for leftover throws from a previous session.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            sync.discardSensor?.().catch((e: any) =>
              Alert.alert('Discard failed', e?.message ?? 'Could not clear the sensor.'),
            );
          },
        },
      ],
    );
  }, [dev.counter, sync]);
```

(Confirm `Alert` is imported and `sync` + `dev` are in scope — they already drive ChooseStep.)

- [ ] **Step 2: Pass it into ChooseStep + render the row**

Add `onDiscard={handleDiscard}` to the `<ChooseStep ... />` props (~line 303). In `ChooseStep`'s props type add `onDiscard: () => void;`, and render below the choiceRow (inside the `canLive` branch and the cached branch — anywhere the sensor has throws):

```tsx
      {counter > 0 && (
        <TouchableOpacity style={styles.discardRow} activeOpacity={0.8} onPress={onDiscard}>
          <Ionicons name="trash-outline" size={14} color="#fca5a5" />
          <Text style={styles.discardRowText}>Discard {counter} throws on sensor</Text>
        </TouchableOpacity>
      )}
```

Add styles:

```tsx
  discardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    width: '100%', paddingVertical: 11, borderRadius: 12, borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)', backgroundColor: 'rgba(248,113,113,0.06)', marginTop: 4 },
  discardRowText: { color: '#fca5a5', fontSize: 13, fontWeight: '700' },
```

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit
git add components/pulse/PulseWizardModal.tsx
git commit -m "feat(pulse): Discard throws on sensor (clear without saving) in wizard"
```

---

## Task 5: Modal = setup only — Start Live closes it

**Files:**
- Modify: `components/pulse/PulseWizardModal.tsx` (`handleStartLive`, step routing)

> Today Start Live routes to the in-modal `live` step (the trap). Rework: Start Live starts the session via context, then closes the modal — the live session keeps running and the on-screen `PulseLiveBar` + monitor + feed take over. The Sync path keeps `syncing → done`.

- [ ] **Step 1: Make Start Live start + close**

Find `handleStartLive`. Change it to start live then close:

```tsx
  const handleStartLive = useCallback(async () => {
    try {
      await live.start();
    } catch (err) {
      console.warn('[pulse] live start failed', err);
      Alert.alert('Could not start live', 'Check the sensor connection and try again.');
      return;
    }
    handleClose(); // leave the modal; live runs on-screen via PulseLiveBar
  }, [live, handleClose]);
```

- [ ] **Step 2: Stop routing to the in-modal live step**

In the step render block (~line 326), remove the `{step === 'live' && (<LiveStep .../> )}` branch (the on-screen bar replaces it). Leave `connect`, `set-anthro`, `choose`, `syncing`, `done`. You may delete the now-unused `LiveStep` component + its `pulseVal`/`pulseDotStyle` animation, OR leave them dead (prefer delete to avoid drift — `LiveStep`, `pulseVal`, `pulseDotStyle`, the `live` red-dot effect at lines 200-224).

- [ ] **Step 3: Fix the progress dots**

`stepIndex` (line 228) maps `syncing/live` → 3 and done → 4. With live gone from the modal, the dots are now: connect/anthro=1, choose=2, syncing=3, done=4 — leave as-is (the live branch is simply never hit). No code change needed beyond removing the `live` render.

- [ ] **Step 4: Verify + manual check + commit**

Run `npx tsc --noEmit`. In the simulator: connect → choose → Start Live → **modal closes**, session is running (verify the header chip flips to LIVE).

```bash
git add components/pulse/PulseWizardModal.tsx
git commit -m "feat(pulse): Start Live closes the modal — live runs on-screen"
```

---

## Task 6: `PulseLiveBar` sticky component

**Files:**
- Create: `components/pulse/PulseLiveBar.tsx`

> A slim sticky bar that shows ONLY while a live session runs. Reads `live` from `usePulse()` context. Renders the pulsing dot + "LIVE" + throw count + a Stop button. Stop calls `live.stop()`.

- [ ] **Step 1: Build the component**

```tsx
// components/pulse/PulseLiveBar.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { usePulse } from '../../lib/pulse/PulseProvider';

export default function PulseLiveBar() {
  const { live } = usePulse();
  const pulseVal = useSharedValue(1);
  React.useEffect(() => {
    if (live.status === 'running') {
      pulseVal.value = withRepeat(
        withSequence(
          withTiming(1.4, { duration: 600, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 600, easing: Easing.inOut(Easing.sin) }),
        ), -1, false,
      );
    } else { pulseVal.value = 1; }
  }, [live.status, pulseVal]);
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulseVal.value }] }));

  if (live.status !== 'running') return null;

  return (
    <View style={styles.bar}>
      <Animated.View style={[styles.dot, dotStyle]} />
      <Text style={styles.live}>LIVE</Text>
      <Text style={styles.count}>{live.throwCount}</Text>
      <Text style={styles.sub}>{live.throwCount === 1 ? 'throw' : 'throws'}</Text>
      <TouchableOpacity style={styles.stop} activeOpacity={0.8} onPress={() => live.stop().catch(() => {})}>
        <Ionicons name="stop" size={12} color="#fca5a5" />
        <Text style={styles.stopText}>Stop</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 8,
    paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14,
    backgroundColor: 'rgba(248,113,113,0.12)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.5)' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#f87171' },
  live: { color: '#fca5a5', fontWeight: '800', letterSpacing: 1.5, fontSize: 13 },
  count: { color: '#fff', fontWeight: '800', fontFamily: 'Menlo', fontSize: 14 },
  sub: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
  stop: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: 'rgba(248,113,113,0.2)', borderWidth: 1, borderColor: '#f87171' },
  stopText: { color: '#fca5a5', fontWeight: '700', fontSize: 12 },
});
```

(Confirm `usePulse` exposes `live` with `status`, `throwCount`, `stop` — it's the same `live` the wizard's `LiveStep` consumed. Match the import path/name to PulseProvider's export.)

- [ ] **Step 2: Verify + commit**

```bash
npx tsc --noEmit
git add components/pulse/PulseLiveBar.tsx
git commit -m "feat(pulse): PulseLiveBar — sticky LIVE/count/Stop bar"
```

---

## Task 7: Mount `PulseLiveBar` on the live screens

**Files:**
- Modify: `screens/WorkoutLoggerScreen.tsx` (inside the `PulseProvider` return, ~line 1136-1147)
- Modify: `screens/WorkloadScreen.tsx` (inside its `PulseProvider` tree)

- [ ] **Step 1: WorkoutLogger**

In the `PulseProvider` block, render the bar above `{body}`:

```tsx
    return (
      <PulseProvider athleteId={athleteId} orgId={orgId}>
        <PulseLiveBar />
        {body}
        <PulseWizardModal scheduledDate={scheduledDate} />
      </PulseProvider>
    );
```

Add `import PulseLiveBar from '../components/pulse/PulseLiveBar';`.

> Note: `body` is a full-screen view; if the bar must overlay rather than push content, wrap in a `<View style={{flex:1}}>` with the bar absolutely positioned at top. Start with in-flow (above body) and adjust in the manual pass if it pushes the header awkwardly.

- [ ] **Step 2: WorkloadScreen**

Open `screens/WorkloadScreen.tsx`, find its `<PulseProvider>` wrap, render `<PulseLiveBar />` just inside it (same pattern). Add the import.

- [ ] **Step 3: Verify + manual + commit**

`npx tsc --noEmit`. Simulator: Start Live (from monitor or wizard) → the sticky LIVE bar appears on the Workout/Workload screen, counts up per throw, Stop ends the session and the bar disappears.

```bash
git add screens/WorkoutLoggerScreen.tsx screens/WorkloadScreen.tsx
git commit -m "feat(pulse): mount PulseLiveBar on workout logger + workload screens"
```

---

## Task 8: Feed — swipe-to-delete + undo

**Files:**
- Modify: `components/pulse/ThrowingThrowsFeed.tsx` (the row + `onDelete`, ~lines 174-292)

> Replace the long-press → Alert delete with a swipe-left → Delete (react-native-gesture-handler `Swipeable`) plus an UNDO snackbar. Keep the soft-delete (`is_valid=false` + excluded metadata) write that already exists; just change how it's triggered and add undo (re-set `is_valid=true`).

- [ ] **Step 1: Track the last delete for undo**

Add state in the feed component:

```tsx
  const [undoThrow, setUndoThrow] = useState<{ id: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

In `onDelete`, after the successful soft-delete update, instead of (or in addition to) the optimistic remove, show undo:

```tsx
    setUndoThrow({ id });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoThrow(null), 5000);
```

Add an `onUndo`:

```tsx
  const onUndo = useCallback(async (id: string) => {
    await supabase.from('pulse_throws')
      .update({ is_valid: true, excluded_reason: null, excluded_by: null, excluded_at: null })
      .eq('id', id);
    setUndoThrow(null);
    refetch(); // re-pull the day's throws (use the feed's existing fetch fn)
  }, [supabase, refetch]);
```

- [ ] **Step 2: Make rows swipeable**

Wrap each row in `Swipeable` (from `react-native-gesture-handler`), revealing a red Delete action that calls `onDelete(id)` directly (skip the Alert — undo covers mistakes):

```tsx
  import { Swipeable } from 'react-native-gesture-handler';
  // ...renderRightActions returns a red 88px "Delete" view; onSwipeableOpen → onDelete(id)
```

Convert `onDelete` to drop the `Alert.alert(...)` wrapper and run the soft-delete directly (the undo snackbar is the safety net).

- [ ] **Step 3: Render the undo snackbar**

Below the list:

```tsx
  {undoThrow && (
    <View style={styles.undoToast}>
      <Text style={styles.undoText}>Throw deleted</Text>
      <TouchableOpacity onPress={() => onUndo(undoThrow.id)}><Text style={styles.undoBtn}>UNDO</Text></TouchableOpacity>
    </View>
  )}
```

Styles: dark pill, `undoBtn` cyan `#9BDDFF` 800-weight.

- [ ] **Step 4: Verify + manual + commit**

`npx tsc --noEmit`. Simulator: swipe a throw → Delete → row goes, total drops, UNDO toast → tapping UNDO restores it.

```bash
git add components/pulse/ThrowingThrowsFeed.tsx
git commit -m "feat(pulse): swipe-to-delete throws + undo snackbar"
```

---

## Task 9: Feed — Show deleted + Restore

**Files:**
- Modify: `components/pulse/ThrowingThrowsFeed.tsx` (query + a filter toggle)

> The day's query filters `is_valid=eq.true` (line 142). Add a "Show deleted (N)" toggle that re-queries with `is_valid=eq.false` and renders those rows greyed with a Restore action (`is_valid=true`).

- [ ] **Step 1: Add a showDeleted toggle + count**

```tsx
  const [showDeleted, setShowDeleted] = useState(false);
```

When `showDeleted`, swap the query filter from `&is_valid=eq.true` to `&is_valid=eq.false` (parameterize the existing fetch URL builder around line 140-142). Render a filter chip row above the list: `All` / `Show deleted (N)`.

- [ ] **Step 2: Render deleted rows with Restore**

In the row, when the row is a deleted one, show a `↺ Restore` button (cyan) instead of the swipe-delete; tapping calls the same `onUndo(id)` from Task 8 (sets `is_valid=true`).

- [ ] **Step 3: Verify + manual + commit**

`npx tsc --noEmit`. Simulator: delete a throw → toggle "Show deleted" → it appears greyed → Restore brings it back to the All list.

```bash
git add components/pulse/ThrowingThrowsFeed.tsx
git commit -m "feat(pulse): show-deleted filter + restore soft-deleted throws"
```

---

## Out of scope (separate follow-ups)
- True MPH arm speed (would require porting the Motus `fingertipVelocity` metric + verification).
- Robust post-commit wipe (retry instead of swallowing failure) + `event_id`/`device_id` unique constraint on `pulse_throws` for dedup. Recommended but separate from this UX rework.
- "These throws may belong to a previous athlete — Discard or Save?" prompt at connect time when cached > 0.
