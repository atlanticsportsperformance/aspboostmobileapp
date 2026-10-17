import { buildLogRow, completeForEdit, upsertSet, IDENTITY_KEYS, type SetKey } from '../lib/logger/saveSet';
import { createOutbox, OUTBOX_KEY, MAX_FAILURES, type OutboxStorage } from '../lib/logger/outbox';

const KEY: SetKey = { workoutInstanceId: 'wi-1', routineExerciseId: 're-1', setNumber: 2 };
const OPTS = { athleteId: 'ath-1', exerciseId: 'ex-1', orgId: 'org-1' };

function memoryStorage(): OutboxStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: async k => (k in data ? data[k] : null),
    setItem: async (k, v) => {
      data[k] = v;
    },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe('buildLogRow', () => {
  it('edit writes draft not complete', () => {
    const row = buildLogRow(KEY, { reps: '5', weight: '135' }, { ...OPTS, complete: false });
    expect(row.is_complete).toBe(false);
    expect(row).toMatchObject({
      workout_instance_id: 'wi-1',
      routine_exercise_id: 're-1',
      set_number: 2,
      athlete_id: 'ath-1',
      exercise_id: 'ex-1',
      org_id: 'org-1',
      actual_reps: 5,
      actual_weight: 135,
    });
  });

  it('Log Set writes complete', () => {
    expect(buildLogRow(KEY, {}, { ...OPTS, complete: true }).is_complete).toBe(true);
  });

  it('always writes the full set state: cleared built-ins are null, custom metrics go to metric_data', () => {
    const row = buildLogRow(
      KEY,
      { reps: '', weight: null, time_seconds: '30', distance: '12.5', notes: 'ok', velo: 82, spin: '' },
      { ...OPTS, complete: true },
    );
    expect(row.actual_reps).toBeNull();
    expect(row.actual_weight).toBeNull();
    expect(row.actual_duration_seconds).toBe(30);
    expect(row.actual_distance).toBe(12.5);
    expect(row.notes).toBe('ok');
    // cleared custom metric is dropped so the full-state write removes it
    expect(row.metric_data).toEqual({ velo: 82 });
  });

  it('fractional reps / seconds are rounded for the int columns; weight/distance keep decimals', () => {
    const r = buildLogRow(KEY, { reps: '7.6', time_seconds: 29.4, weight: '132.5', distance: 10.25 }, { ...OPTS, complete: true });
    expect(r.actual_reps).toBe(8);
    expect(r.actual_duration_seconds).toBe(29);
    expect(r.actual_weight).toBe(132.5);
    expect(r.actual_distance).toBe(10.25);
  });

  it('non-numeric built-in values become null instead of NaN', () => {
    expect(buildLogRow(KEY, { reps: 'abc' }, { ...OPTS, complete: false }).actual_reps).toBeNull();
  });

  it('rpe included only when provided', () => {
    expect('rpe' in buildLogRow(KEY, {}, { ...OPTS, complete: true })).toBe(false);
    expect(buildLogRow(KEY, {}, { ...OPTS, complete: true, rpe: 8 }).rpe).toBe(8);
    expect(buildLogRow(KEY, {}, { ...OPTS, complete: true, rpe: null }).rpe).toBeNull();
  });

  it('completion-only write (overview circle / check) sends just is_complete + identity keys', () => {
    const r = buildLogRow(KEY, { reps: '5', weight: '135', velo: 80, notes: 'x' }, { ...OPTS, complete: true, fields: [] });
    expect(r).toEqual({
      workout_instance_id: 'wi-1', routine_exercise_id: 're-1', set_number: 2,
      athlete_id: 'ath-1', exercise_id: 'ex-1', org_id: 'org-1', is_complete: true,
    });
  });

  it('rpe-only write sends just rpe + identity keys (no is_complete, no values)', () => {
    const r = buildLogRow(KEY, { reps: '5' }, { ...OPTS, rpe: 7.5, fields: [] });
    expect(Object.keys(r).sort()).toEqual([...IDENTITY_KEYS, 'rpe'].sort());
    expect(r.rpe).toBe(7.5);
  });

  it('field edit sends only the edited fields; a custom metric sends the set\'s whole metric_data', () => {
    const fields = { reps: '5', weight: '', velo: 80, spin: '' };
    const w = buildLogRow(KEY, fields, { ...OPTS, fields: ['weight'] });
    expect(w).toMatchObject({ actual_weight: null });
    expect('actual_reps' in w || 'metric_data' in w || 'is_complete' in w || 'notes' in w).toBe(false);
    const m = buildLogRow(KEY, fields, { ...OPTS, fields: ['spin'] });
    expect(m.metric_data).toEqual({ velo: 80 });
    expect('actual_reps' in m).toBe(false);
  });

  it('omits org_id when unknown', () => {
    expect('org_id' in buildLogRow(KEY, {}, { athleteId: 'a', exerciseId: 'e', complete: false })).toBe(false);
  });
});

describe('upsertSet', () => {
  it('writes through the upsert_exercise_log RPC', async () => {
    const rpc = jest.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: 'log-id', error: null }));
    const row = buildLogRow(KEY, { reps: 3 }, { ...OPTS, complete: true });
    await expect(upsertSet({ rpc }, row)).resolves.toEqual({ ok: true, id: 'log-id' });
    expect(rpc).toHaveBeenCalledWith('upsert_exercise_log', { p_row: row });
  });

  it('server rejection (error with a code / 4xx) is not retryable', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(upsertSet({ rpc: async () => ({ data: null, error: { message: 'x', code: '42501' }, status: 403 }) }, {})).resolves.toEqual({ ok: false, retryable: false });
    await expect(upsertSet({ rpc: async () => ({ data: null, error: { message: 'x', code: '' }, status: 400 }) }, {})).resolves.toEqual({ ok: false, retryable: false });
    quiet.mockRestore();
  });

  it('network failure (throw, or error with no code and no response) is retryable', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(upsertSet({ rpc: async () => { throw new TypeError('Network request failed'); } }, {})).resolves.toEqual({ ok: false, retryable: true });
    await expect(upsertSet({ rpc: async () => ({ data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 }) }, {})).resolves.toEqual({ ok: false, retryable: true });
    quiet.mockRestore();
  });
});

describe('outbox', () => {
  const row = (fields: Record<string, unknown>, complete: boolean, key: SetKey = KEY) =>
    buildLogRow(key, fields, { ...OPTS, complete });

  it('concurrent completes write one row', async () => {
    const storage = memoryStorage();
    const send = jest.fn(async (_r: Record<string, unknown>) => ({ ok: true }));
    const ob = createOutbox(storage, send);
    await Promise.all([ob.enqueue(row({ reps: 5 }, true)), ob.enqueue(row({ reps: 5 }, true))]);
    expect(await ob.size()).toBe(1);
    expect(await ob.flush()).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('writes for the same set merge per key (later value of a key wins)', async () => {
    const send = jest.fn(async (_r: Record<string, unknown>) => ({ ok: true }));
    const ob = createOutbox(memoryStorage(), send);
    await ob.enqueue(buildLogRow(KEY, { reps: 5, weight: 135 }, { ...OPTS, fields: ['reps', 'weight'] }));
    await ob.enqueue(buildLogRow(KEY, {}, { ...OPTS, complete: true, fields: [] }));
    await ob.enqueue(buildLogRow(KEY, { reps: 6 }, { ...OPTS, fields: ['reps'] }));
    await ob.enqueue(buildLogRow(KEY, {}, { ...OPTS, rpe: 8, fields: [] }));
    await ob.flush();
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0][0];
    expect(sent).toMatchObject({ actual_reps: 6, actual_weight: 135, is_complete: true, rpe: 8 });
    expect('metric_data' in sent).toBe(false);
    expect('notes' in sent).toBe(false);
  });

  it('drop() removes only that workout\'s queued rows', async () => {
    const ob = createOutbox(memoryStorage(), async () => ({ ok: false }));
    await ob.enqueue(row({ reps: 5 }, true));
    await ob.enqueue(row({ reps: 5 }, true, { ...KEY, workoutInstanceId: 'wi-2' }));
    await ob.drop('wi-1');
    expect(await ob.pending()).toEqual([expect.objectContaining({ workout_instance_id: 'wi-2' })]);
  });

  it('different sets are kept separately', async () => {
    const ob = createOutbox(memoryStorage(), async () => ({ ok: true }));
    await ob.enqueue(row({}, true));
    await ob.enqueue(row({}, true, { ...KEY, setNumber: 3 }));
    expect(await ob.size()).toBe(2);
  });

  it('outbox survives restart and flushes once', async () => {
    const storage = memoryStorage();
    await createOutbox(storage, async () => ({ ok: false })).enqueue(row({ reps: 5 }, true));
    expect(storage.data[OUTBOX_KEY]).toBeDefined();

    const send = jest.fn(async (_r: Record<string, unknown>) => ({ ok: true }));
    const restarted = createOutbox(storage, send);
    expect(await restarted.flush()).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await restarted.size()).toBe(0);
    await restarted.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('failed send stays queued', async () => {
    const ob = createOutbox(memoryStorage(), async () => ({ ok: false }));
    await ob.enqueue(row({ reps: 5 }, true));
    expect(await ob.flush()).toBe(0);
    expect(await ob.size()).toBe(1);
  });

  it('a throwing send stays queued and does not block other rows', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    const send = jest.fn(async (r: Record<string, unknown>) => {
      if (r.set_number === 2) throw new Error('offline');
      return { ok: true };
    });
    const ob = createOutbox(memoryStorage(), send);
    await ob.enqueue(row({}, true));
    await ob.enqueue(row({}, true, { ...KEY, setNumber: 3 }));
    expect(await ob.flush()).toBe(1);
    expect(await ob.size()).toBe(1);
    quiet.mockRestore();
  });

  it('flush during flush does not send twice', async () => {
    const gate = deferred<{ ok: boolean }>();
    const send = jest.fn((_r: Record<string, unknown>) => gate.promise);
    const ob = createOutbox(memoryStorage(), send);
    await ob.enqueue(row({ reps: 5 }, true));
    const first = ob.flush();
    const second = ob.flush();
    await new Promise(r => setTimeout(r, 0));
    expect(send).toHaveBeenCalledTimes(1);
    gate.resolve({ ok: true });
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await ob.size()).toBe(0);
  });

  it('enqueue during flush survives (same set re-edited while its old row is sending)', async () => {
    const gate = deferred<{ ok: boolean }>();
    const sent: Record<string, unknown>[] = [];
    let calls = 0;
    const send = jest.fn(async (r: Record<string, unknown>) => {
      sent.push(r);
      calls += 1;
      return calls === 1 ? gate.promise : { ok: true };
    });
    const ob = createOutbox(memoryStorage(), send);
    await ob.enqueue(row({ reps: 5 }, false));
    const flushing = ob.flush();
    await new Promise(r => setTimeout(r, 0));
    await ob.enqueue(row({ reps: 6 }, true)); // newer state while v1 is in flight
    const again = ob.flush(); // screen flushes after each enqueue
    gate.resolve({ ok: true });
    await Promise.all([flushing, again]);
    expect(sent.map(r => r.actual_reps)).toEqual([5, 6]);
    expect(sent[1].is_complete).toBe(true);
    expect(await ob.size()).toBe(0);
  });

  it('enqueue during flush with no new flush call stays queued', async () => {
    const gate = deferred<{ ok: boolean }>();
    const ob = createOutbox(memoryStorage(), () => gate.promise);
    await ob.enqueue(row({ reps: 5 }, true));
    const flushing = ob.flush();
    await new Promise(r => setTimeout(r, 0));
    await ob.enqueue(row({}, true, { ...KEY, setNumber: 9 }));
    gate.resolve({ ok: true });
    await flushing;
    expect(await ob.size()).toBe(1);
  });

  it('after 5 consecutive failures a set backs off to foreground-only flushes (kept, logged)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true;
    const send = jest.fn(async (r: Record<string, unknown>) => ({ ok: r.set_number === 2 ? !fail : true }));
    const ob = createOutbox(memoryStorage(), send);
    await ob.enqueue(row({ reps: 5 }, true));
    expect(MAX_FAILURES).toBe(5);
    for (let i = 0; i < 5; i++) await ob.flush();
    expect(send).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledTimes(1);

    // backed off: regular flushes skip it, other sets still go out
    await ob.enqueue(row({}, true, { ...KEY, setNumber: 3 }));
    expect(await ob.flush()).toBe(1);
    expect(send.mock.calls.filter(c => c[0].set_number === 2)).toHaveLength(5);
    expect(await ob.size()).toBe(1);

    // foreground flush retries it; success clears the back-off
    fail = false;
    expect(await ob.flush({ foreground: true })).toBe(1);
    expect(await ob.size()).toBe(0);
    warn.mockRestore();
  });

  it('network failures never back a set off', async () => {
    const send = jest.fn(async () => ({ ok: false, retryable: true }));
    const ob = createOutbox(memoryStorage(), send);
    await ob.enqueue(row({ reps: 5 }, true));
    for (let i = 0; i < 8; i++) await ob.flush();
    expect(send).toHaveBeenCalledTimes(8);
    expect(await ob.size()).toBe(1);
  });

  it('a new enqueue for a backed-off set resets its failure count', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const send = jest.fn(async () => ({ ok: false }));
    const ob = createOutbox(memoryStorage(), send);
    await ob.enqueue(row({ reps: 5 }, false));
    for (let i = 0; i < 5; i++) await ob.flush();
    await ob.flush();
    expect(send).toHaveBeenCalledTimes(5); // backed off
    await ob.enqueue(row({ reps: 5 }, true)); // athlete logs the set again
    await ob.flush();
    expect(send).toHaveBeenCalledTimes(6);
    warn.mockRestore();
  });

  it('a flush requested as the previous one finishes still runs', async () => {
    const send = jest.fn(async () => ({ ok: true }));
    const ob = createOutbox(memoryStorage(), send);
    await ob.enqueue(row({ reps: 5 }, true));
    const first = ob.flush();
    await first;
    await ob.enqueue(row({}, true, { ...KEY, setNumber: 4 }));
    await ob.flush();
    expect(await ob.size()).toBe(0);
  });

  it('a success resets the failure count', async () => {
    let calls = 0;
    const send = jest.fn(async () => ({ ok: ++calls === 4 }));
    const ob = createOutbox(memoryStorage(), send);
    await ob.enqueue(row({}, true));
    for (let i = 0; i < 4; i++) await ob.flush(); // 3 fails, then ok
    await ob.enqueue(row({ reps: 1 }, true));
    for (let i = 0; i < 4; i++) await ob.flush(); // 4 more fails — under the cap
    await ob.flush();
    expect(send).toHaveBeenCalledTimes(9);
  });

  it('pending() returns queued rows for resume overlay', async () => {
    const ob = createOutbox(memoryStorage(), async () => ({ ok: false }));
    await ob.enqueue(row({ reps: 5 }, true));
    expect(await ob.pending()).toEqual([expect.objectContaining({ actual_reps: 5, set_number: 2 })]);
  });

  it('corrupt storage is treated as empty', async () => {
    const storage = memoryStorage();
    storage.data[OUTBOX_KEY] = '{not json';
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ob = createOutbox(storage, async () => ({ ok: true }));
    expect(await ob.size()).toBe(0);
    await ob.enqueue(row({}, true));
    expect(await ob.size()).toBe(1);
    quiet.mockRestore();
  });
});

describe('completeForEdit — draft vs complete on a field edit', () => {
  it('editing a set that is not logged yet is a draft', () => {
    expect(completeForEdit(undefined, 0)).toBe(false);
    expect(completeForEdit([false, false], 1)).toBe(false);
  });
  it('editing a completed set stays complete', () => {
    expect(completeForEdit([true, false], 0)).toBe(true);
    expect(buildLogRow(KEY, { reps: 4 }, { ...OPTS, complete: completeForEdit([false, true], 1) }).is_complete).toBe(true);
  });
});
