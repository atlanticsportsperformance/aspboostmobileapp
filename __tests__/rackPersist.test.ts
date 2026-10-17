const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      await Promise.resolve();
      store[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete store[k];
    }),
  },
}));

import { createRackPersist, setWriteRow, REP_QUEUE_KEY, SET_QUEUE_KEY } from '../lib/rack/persist';
import type { RepWrite, SetSummary } from '../lib/rack/engine';

const ORG = 'org-1';

const summary = (over: Partial<SetSummary> = {}): SetSummary => ({
  rackId: 'rack-3',
  source: 'rack',
  athleteId: 'tyler',
  workoutInstanceId: 'wi-1',
  routineExerciseId: 're-squat',
  exerciseId: 'ex-squat',
  setNumber: 2,
  loadLb: 205,
  setStartedAt: '2026-10-17T15:00:00.000Z',
  reps: [
    { v: 0.8, pv: 1.1, rom: 20, partial: false },
    { v: 0.4, pv: 0.6, rom: 6, partial: true },
    { v: 0.7, pv: 1.0, rom: 20, partial: false },
  ],
  fullReps: 2,
  avgV: 0.75,
  bestV: 0.8,
  dropPct: 12.5,
  zone: [0.6, 0.9],
  endedBy: 'ipad',
  free: false,
  ...over,
});

const rep = (over: Partial<RepWrite> = {}): RepWrite => ({
  clientRepId: 'rack-3:tyler:1:1',
  rackId: 'rack-3',
  athleteId: 'tyler',
  workoutInstanceId: 'wi-1',
  routineExerciseId: 're-squat',
  exerciseId: 'ex-squat',
  setNumber: 2,
  repIndex: 1,
  loadLb: 205,
  meanVelocity: 0.8,
  peakVelocity: 1.1,
  meanPowerW: 900,
  peakPowerW: 1800,
  romIn: 20,
  concentricS: 0.5,
  isPartial: false,
  zone: 'in',
  dropPct: 0,
  dropCue: false,
  receivedAt: '2026-10-17T15:00:01.000Z',
  ...over,
});

function mockClient(opts: { upsertResult?: () => any; rpcResult?: () => any } = {}) {
  const upsert = jest.fn(async (_rows: any[], _o: any) => (opts.upsertResult ? opts.upsertResult() : { error: null, status: 201 }));
  const rpc = jest.fn(async (_fn: string, _args: any) => (opts.rpcResult ? opts.rpcResult() : { data: 'log-id', error: null, status: 200 }));
  const from = jest.fn((_t: string) => ({ upsert }));
  return { client: { rpc, from } as any, rpc, upsert, from };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('set row shape', () => {
  it('carries identity keys, reps/weight/complete and metric_data_patch.vbt — never metric_data', () => {
    const row = setWriteRow(summary(), ORG)!;
    expect(row).toMatchObject({
      workout_instance_id: 'wi-1',
      routine_exercise_id: 're-squat',
      set_number: 2,
      athlete_id: 'tyler',
      exercise_id: 'ex-squat',
      org_id: ORG,
      actual_reps: 2,
      actual_weight: 205,
      is_complete: true,
    });
    expect(row).not.toHaveProperty('metric_data');
    expect(row).not.toHaveProperty('notes');
    expect(row).not.toHaveProperty('rpe');
    expect((row.metric_data_patch as any).vbt).toEqual({
      reps: [
        { v: 0.8, pv: 1.1, rom: 20, partial: false },
        { v: 0.4, pv: 0.6, rom: 6, partial: true },
        { v: 0.7, pv: 1.0, rom: 20, partial: false },
      ],
      avg_v: 0.75,
      best_v: 0.8,
      zone: [0.6, 0.9],
      drop_pct: 12.5,
      source: 'rack',
      rack: 'rack-3',
      ended_by: 'ipad',
    });
  });

  it('unknown load does not send actual_weight (would clear the phone value)', () => {
    const row = setWriteRow(summary({ loadLb: null }), ORG)!;
    expect(row).not.toHaveProperty('actual_weight');
    expect(row.actual_reps).toBe(2);
  });

  it('endSet sends exactly that row through upsert_exercise_log', async () => {
    const m = mockClient();
    const p = createRackPersist({ client: m.client, orgId: ORG });
    await p.endSet(summary());
    await p.flush();
    expect(m.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = m.rpc.mock.calls[0];
    expect(fn).toBe('upsert_exercise_log');
    expect(args.p_row).toEqual(setWriteRow(summary(), ORG));
    expect(args.p_row).not.toHaveProperty('metric_data');
  });
});

describe('free set', () => {
  it('writes only vbt_reps', async () => {
    const m = mockClient();
    const p = createRackPersist({ client: m.client, orgId: ORG });
    const free = summary({ workoutInstanceId: null, routineExerciseId: null, exerciseId: null, setNumber: null, free: true });
    await p.writeRep(rep({ workoutInstanceId: null, routineExerciseId: null, exerciseId: null, setNumber: null }));
    await p.endSet(free);
    await p.amendSet(free);
    expect(setWriteRow(free, ORG)).toBeNull();
    expect(await p.pending()).toEqual({ reps: 1, sets: 0 });
    await p.flush();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.from).toHaveBeenCalledWith('vbt_reps');
    expect(m.upsert).toHaveBeenCalledTimes(1);
    expect(m.upsert.mock.calls[0][0][0]).toMatchObject({ workout_instance_id: null, org_id: ORG, client_rep_id: 'rack-3:tyler:1:1' });
  });
});

describe('double end writes once', () => {
  it('same set key enqueued twice: one item queued with the latest payload, one RPC per flush', async () => {
    const m = mockClient();
    const p = createRackPersist({ client: m.client, orgId: ORG });
    await p.endSet(summary({ fullReps: 2 }));
    await p.amendSet(summary({ fullReps: 3, endedBy: 'phone' }));
    const queued = await p.setQueue.peekAll();
    expect(queued).toHaveLength(1);
    expect(queued[0].key).toBe('wi-1:re-squat:2');
    expect(queued[0].row.actual_reps).toBe(3);
    expect((queued[0].row.metric_data_patch as any).vbt.ended_by).toBe('phone');
    await p.flush();
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc.mock.calls[0][1].p_row.actual_reps).toBe(3);
    await p.flush();
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });

  it('a replacement during an in-flight send stays queued and goes out next', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    let calls = 0;
    const m = mockClient({
      rpcResult: () => ({ data: 'id', error: null, status: 200 }),
    });
    m.rpc.mockImplementation(async () => {
      calls++;
      if (calls === 1) await gate;
      return { data: 'id', error: null, status: 200 };
    });
    const p = createRackPersist({ client: m.client, orgId: ORG });
    await p.endSet(summary({ fullReps: 2 }));
    const f = p.flush();
    await new Promise(r => setTimeout(r, 5));
    await p.amendSet(summary({ fullReps: 3 }));
    release();
    await f;
    expect(m.rpc.mock.calls.map(c => c[1].p_row.actual_reps)).toEqual([2, 3]);
    expect(await p.pending()).toEqual({ reps: 0, sets: 0 });
  });

  it('different sets stay separate items', async () => {
    const p = createRackPersist({ client: mockClient().client, orgId: ORG });
    await p.endSet(summary({ setNumber: 1 }));
    await p.endSet(summary({ setNumber: 2 }));
    expect((await p.setQueue.peekAll()).map(i => i.key)).toEqual(['wi-1:re-squat:1', 'wi-1:re-squat:2']);
  });
});

describe('vbt_reps queue', () => {
  it('batch upsert ignores duplicates on client_rep_id', async () => {
    const m = mockClient();
    const p = createRackPersist({ client: m.client, orgId: ORG });
    await p.writeRep(rep({ clientRepId: 'a', repIndex: 1 }));
    await p.writeRep(rep({ clientRepId: 'a', repIndex: 1 }));
    await p.writeRep(rep({ clientRepId: 'b', repIndex: 2 }));
    await p.flush();
    expect(m.upsert).toHaveBeenCalledTimes(1);
    const [rows, o] = m.upsert.mock.calls[0];
    expect(rows.map((r: any) => r.client_rep_id)).toEqual(['a', 'b']);
    expect(o).toEqual({ onConflict: 'client_rep_id', ignoreDuplicates: true });
    expect(store[REP_QUEUE_KEY]).toBeUndefined();
  });

  it('a unique violation counts as success', async () => {
    const m = mockClient({ upsertResult: () => ({ error: { code: '23505', message: 'duplicate key' }, status: 409 }) });
    const p = createRackPersist({ client: m.client, orgId: ORG });
    await p.writeRep(rep());
    await p.flush();
    expect(await p.repQueue.size()).toBe(0);
    expect(await p.repQueue.flush()).toEqual({ sent: 0, failed: 0 });
  });

  it('a network failure keeps the rep queued', async () => {
    const m = mockClient();
    m.upsert.mockRejectedValueOnce(new TypeError('Network request failed'));
    const p = createRackPersist({ client: m.client, orgId: ORG });
    await p.writeRep(rep());
    await p.flush();
    expect(await p.repQueue.size()).toBe(1);
  });

  it('an expired JWT (401) keeps the rep queued; other 4xx drop it', async () => {
    const m = mockClient({ upsertResult: () => ({ error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }) });
    const p = createRackPersist({ client: m.client, orgId: ORG });
    await p.writeRep(rep());
    await p.flush();
    expect(await p.repQueue.size()).toBe(1);

    m.upsert.mockImplementation(async () => ({ error: { code: '23503', message: 'fk' }, status: 409 }));
    await p.flush();
    expect(await p.repQueue.size()).toBe(0);
  });

  it('set queue uses its own storage key', async () => {
    const p = createRackPersist({ client: mockClient().client, orgId: ORG });
    await p.endSet(summary());
    expect(JSON.parse(store[SET_QUEUE_KEY])).toHaveLength(1);
  });
});
