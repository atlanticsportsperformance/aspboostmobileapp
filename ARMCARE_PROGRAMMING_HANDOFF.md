# ArmCare in programming — iOS handoff

This is the second ArmCare feature on top of the wizard. Tests are now
**first-class scheduled items** alongside workouts — coaches can prescribe
them from a plan, a group calendar, an athlete's individual calendar, or
a recurring rule. The athlete sees the prescribed test as a card on their
day view and can tap straight into the wizard to take it.

---

## What's already wired (this repo)

### Schema (web migration, applied to live Supabase)
File: `aspboostapp/supabase/migrations/20260429110000_armcare_program_days_and_instances.sql`

- `armcare_program_days` — coach drops a test on plan week W / day D
- `group_armcare_schedules` — coach drops a test on a group's calendar date
- `armcare_test_recurrences` — "every Monday" / "every 7 days" rules,
  scoped to an athlete OR a group
- `armcare_test_instances` — **the per-athlete-per-date table the iOS
  app reads.** All four sources (plan / group / one_off / recurring) funnel
  into this same table.
- `workout_instances.requires_armcare_test_instance_id` — gating column
  so a coach can require a test before the throwing workout on the same day

Trigger: when `completed_session_id` is set on an instance, status auto-flips
to `'completed'`.

### iOS — DashboardScreen.tsx
- New interface `ArmcareTestInstance` (lines near `WorkoutInstance`)
- New state `armcareTestInstances` + `setArmcareTestInstances`
- Parallel fetch in the loadDashboard `Promise.all` querying
  `armcare_test_instances` for this athlete
- `getArmcareTestsForDate(date)` filter helper
- `selectedDateArmcareTests` derivation
- Cards rendered at the top of the day-detail scroll, ABOVE workouts
  (so a gating test reads first)

### iOS — `components/dashboard/ArmcareDayCard.tsx` (new file)
- Red-accent card matching the rest of the ArmCare design language
- Shows prescribed-from source (plan / group / coach / recurring)
- "Start" pill if not_started; "Done" badge if completed (lower opacity)
- onPress navigates to `ArmCareWizard` with `{ athleteId, testInstanceId }`

### iOS — ArmCareWizardScreen.tsx
- Accepts `testInstanceId?: string` route param
- On successful session save, updates `armcare_test_instances` to set
  `completed_session_id` (best-effort; non-fatal on failure)
- Trigger on the DB flips status to 'completed' automatically

---

## How a coach gets a test onto an athlete's day (current state)

**Right now**, only the database / SQL approach works — no coach UI yet.
Insert a row directly via Studio or SQL:

```sql
insert into armcare_test_instances (
  source_type, athlete_id, scheduled_date, status, notes
) values (
  'one_off',
  '<athlete_id>',
  current_date + interval '1 day',
  'not_started',
  'Pre-throw assessment'
);
```

(One row already seeded for Max DiTondo on 2026-05-01 to verify rendering.)

The UI to schedule from plans / group calendars / athlete calendars is
the next thing to build (web side, separate session).

---

## What you (iOS Claude) should verify

Open the app as Max DiTondo. The dashboard should show a card on
**May 1, 2026** that looks like:

```
┌────────────────────────────────────────────┐
│ 💪  ✱ ARM CARE        Coach prescribed     │
│     Take ArmCare test                      │
│     Pre-throw assessment — added by coach  │
│     for testing                  [ Start ] │
└────────────────────────────────────────────┘
```

Tap **Start** → wizard runs as before, but with `testInstanceId` in the
route params. After save:

1. `armcare_sessions` row inserted (existing behavior)
2. `armcare_test_instances` row updated with `completed_session_id`
3. DB trigger flips `status` → `completed`
4. When dashboard reloads, the same card now reads:

```
┌────────────────────────────────────────────┐
│ 💪  ✱ ARM CARE        Coach prescribed     │
│     ArmCare check complete                 │
│     Pre-throw assessment...      [ ✓ Done ]│
└────────────────────────────────────────────┘
```

(Card is at 70% opacity in the completed state.)

---

## Things to verify on a real session

1. **Card shows up on the right date.** Date filter uses the local date
   string (no UTC offset bugs). Check that a card scheduled for "today"
   shows on today regardless of timezone.
2. **Tap navigates to wizard with the param.** Console-log
   `route.params.testInstanceId` at the top of `ArmCareWizardScreen` if in
   doubt.
3. **Linkback succeeds.** After completing a session, refresh the dashboard
   and confirm the card flips to "Done." Also query Supabase Studio:
   ```sql
   select id, status, completed_session_id, scheduled_date
     from armcare_test_instances
     where athlete_id = '<id>' order by scheduled_date desc;
   ```
4. **Wizard still works without a `testInstanceId`** (e.g. when launched
   from the home tab's Start Exam). The linkback block is gated on
   `testInstanceId && insertedSession?.id` so it's a no-op when absent.
5. **RLS lets the athlete update their own instance.** The migration's
   policy `armcare_test_instances_update_self_or_coach` allows the
   athlete to set `completed_session_id` on rows where they own the
   linked athlete record. If you see "permission denied" in the wizard
   on save, the linkback update is the likely culprit — check the policy.

---

## Known gaps (work for the next session)

1. **Coach UI to schedule tests.** No buttons / drag-targets yet. This
   has to land before athletes can be prescribed tests outside of manual
   SQL. Three surfaces:
   - Plan-builder: drag "ArmCare test" onto a plan-day cell
     (writes `armcare_program_days`; plan-assignment hook fans out to
     `armcare_test_instances`)
   - Group calendar: drop test on a date
     (writes `group_armcare_schedules`; auto_assign fans out)
   - Athlete profile calendar: ad-hoc "Schedule test" button
     (writes `armcare_test_instances` directly with `source_type='one_off'`)
2. **Recurrence materialization.** `armcare_test_recurrences` table
   exists, but no cron yet to materialize instances into the future. Add
   an Inngest function that runs daily, computes the next 7 days of
   instances per active recurrence, and inserts into
   `armcare_test_instances` (idempotent on athlete + date + recurrence_id).
3. **Workout gating UI.** `workout_instances.requires_armcare_test_instance_id`
   exists; iOS doesn't yet read it. When set, the throwing workout's Start
   button should be disabled until the linked instance is `completed`,
   with a tooltip / inline copy explaining why.
4. **Group-plan sync.** `is_synced_with_group` on `armcare_test_instances`
   mirrors workout pattern. If a coach edits the group-level schedule,
   propagation logic needs to update non-detached instances.
5. **Day-view ordering with workouts.** Currently ArmCare cards render at
   the top of the day list. If multiple tests + multiple workouts exist
   on the same day, you might want to interleave by `scheduled_time` or
   render tests inside a "Pre-workout" group.

---

## Quick repro commands

```bash
# Apply the migration locally if needed (already applied in production)
psql $DATABASE_URL -f /path/to/20260429110000_armcare_program_days_and_instances.sql

# Schedule a test for an athlete tomorrow (replace ID + date)
psql $DATABASE_URL -c "
  insert into armcare_test_instances (
    source_type, athlete_id, scheduled_date, status, notes
  ) values (
    'one_off', '<uuid>', current_date + 1, 'not_started',
    'Pre-throw assessment'
  );
"

# Verify the row + later confirm completion
psql $DATABASE_URL -c "
  select scheduled_date, status, source_type, completed_session_id
    from armcare_test_instances
    where athlete_id = '<uuid>' order by scheduled_date desc;
"
```

---

## What NOT to touch

- The wizard's BLE driver, scoring math, and audio cues. Those are
  validated against the official ArmCare app and locked.
- The Pulse BLE driver and workout integration. ArmCare uses a separate
  sensor (Activ5) and the test runs in its own wizard — there is never
  simultaneous Pulse + Activ5 BLE activity.
- The `armcare_sessions` schema. The new tables hang off it but don't
  modify it.
