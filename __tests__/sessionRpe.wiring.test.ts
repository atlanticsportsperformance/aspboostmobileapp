import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../lib/supabase', () => ({ supabase: {} }));
jest.mock('../lib/workoutRefreshSignal', () => ({ markWorkoutListDirty: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));

import { createSyncAll } from '../lib/logger/syncAll';
import { isRetryableError, completionPatch, createPendingCompletions, PENDING_COMPLETE_KEY, type CompleteSend } from '../lib/logger/pendingComplete';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const logger = read('screens/WorkoutLoggerScreen.tsx');
const completed = read('screens/CompletedWorkoutScreen.tsx');
const sheet = read('components/logger/SessionRpeSheet.tsx');
const sync = read('lib/logger/syncAll.ts');
const hookSrc = read('hooks/useOutboxForegroundSync.ts');

function mem() {
  const m: Record<string, string> = {};
  return { getItem: async (k: string) => m[k] ?? null, setItem: async (k: string, v: string) => void (m[k] = v) };
}
const I = (id: string, rpe?: number) => ({ workoutInstanceId: id, completedAt: '2026-10-17T10:00:00Z', ...(rpe != null ? { sessionRpe: rpe } : {}) });
const NET = { ok: false, retryable: true };
const REJ = { ok: false, retryable: false, message: 'nope' };

describe('session RPE gating (wiring)', () => {
  it('sheet only when ask_session_rpe; 1-10 + Skip', () => {
    expect(logger).toMatch(/if \(workout\?\.ask_session_rpe\)\s*\{\s*setShowSessionRpe\(true\)/);
    expect(logger).toMatch(/workout\?\.ask_session_rpe \? \(\s*<SessionRpeSheet/);
    expect(sheet).toContain('[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]');
    expect(sheet).toContain('Skip');
  });
  it('Android back cancels, does not complete', () => {
    expect(sheet).toContain('onRequestClose={onCancel}');
    expect(logger).toContain('handleCancelSessionRpe = () => setShowSessionRpe(false)');
  });
  it('outbox flushes before completion; sync chains completions after sets', () => {
    const fin = logger.slice(logger.indexOf('const finalizeWorkout'));
    expect(fin.indexOf('loggerOutbox.flush')).toBeLessThan(fin.indexOf('pendingCompletions.complete'));
    expect(sync).toMatch(/\.flush\(\{ foreground: true \}\)[\s\S]*\.then\(\(\) => pending\.flush\(\)\)/);
    expect(hookSrc).toContain('syncAll');
  });
  it('CompletedWorkout select includes ask_rpe; reset/reopen clear queue and reset clears session_rpe', () => {
    expect(completed).toMatch(/ask_rpe,/);
    expect(completed).toMatch(/\brounds,/);
    expect(completed).toMatch(/\brpe,\n\s*metric_data/);
    expect(completed).toContain('session_rpe: null');
    expect(completed.match(/pendingCompletions\.clear\(workoutInstanceId\)/g)?.length).toBe(2);
    expect(completed).toContain('LOGGER_COLORS.rpe');
    expect(completed).not.toContain('#D9A441');
  });
});

describe('pending completions', () => {
  it('Skip patch has no session_rpe; chosen rpe is included', () => {
    expect(completionPatch(I('a'))).not.toHaveProperty('session_rpe');
    expect(completionPatch(I('a', 7))).toMatchObject({ status: 'completed', session_rpe: 7 });
  });
  it('network failure is queued; server failure is not', async () => {
    const st = mem();
    const send: CompleteSend = jest.fn().mockResolvedValueOnce(NET).mockResolvedValueOnce(REJ);
    const pc = createPendingCompletions(st, send, async () => 'u1');
    expect(await pc.complete(I('a'))).toEqual({ status: 'queued' });
    expect((await pc.pending()).map(x => x.workoutInstanceId)).toEqual(['a']);
    expect(await pc.complete(I('b'))).toEqual({ status: 'rejected', message: 'nope' });
    expect((await pc.pending()).map(x => x.workoutInstanceId)).toEqual(['a']);
  });
  it('successful online finish clears an older queued intent', async () => {
    const send: CompleteSend = jest.fn().mockResolvedValueOnce(NET).mockResolvedValueOnce({ ok: true });
    const pc = createPendingCompletions(mem(), send, async () => 'u1');
    await pc.complete(I('a'));
    expect(await pc.complete(I('a', 8))).toEqual({ status: 'sent' });
    expect(await pc.pending()).toEqual([]);
  });
  it('replay sends only the current user\'s entries; others stay queued', async () => {
    const st = mem();
    let user = 'u1';
    const send: CompleteSend = jest.fn().mockResolvedValueOnce(NET).mockResolvedValueOnce(NET).mockResolvedValue({ ok: true });
    const pc = createPendingCompletions(st, send, async () => user);
    await pc.complete(I('a'));
    user = 'u2';
    await pc.complete(I('b'));
    (send as jest.Mock).mockClear();
    expect(await pc.flush()).toBe(1);
    expect((send as jest.Mock).mock.calls.map(c => c[0].workoutInstanceId)).toEqual(['b']);
    expect((await pc.pending()).map(x => x.workoutInstanceId)).toEqual(['a']);
  });
  it('0-row update on replay is kept, not success', async () => {
    const send: CompleteSend = jest.fn().mockResolvedValueOnce(NET).mockResolvedValue({ ok: false, retryable: false, zeroRows: true });
    const pc = createPendingCompletions(mem(), send, async () => 'u1');
    await pc.complete(I('a'));
    expect(await pc.flush()).toBe(0);
    expect(await pc.pending()).toHaveLength(1);
  });
  it('replay success removes the entry; clear() drops a workout\'s entry', async () => {
    const st = mem();
    const send: CompleteSend = jest.fn().mockResolvedValueOnce(NET).mockResolvedValueOnce(NET).mockResolvedValue({ ok: true });
    const pc = createPendingCompletions(st, send, async () => 'u1');
    await pc.complete(I('a'));
    await pc.complete(I('b'));
    await pc.clear('b');
    expect(await pc.flush()).toBe(1);
    expect(await pc.pending()).toEqual([]);
    expect(PENDING_COMPLETE_KEY).toBeTruthy();
  });
  it('classifies errors: 5xx and PGRST000-002 retryable; 4xx/coded final; no code retryable', () => {
    expect(isRetryableError({ code: '' }, 503)).toBe(true);
    expect(isRetryableError({ code: 'PGRST001' }, 400)).toBe(true);
    expect(isRetryableError({ code: 'PGRST002' })).toBe(true);
    expect(isRetryableError({ code: '42501' }, 403)).toBe(false);
    expect(isRetryableError({ code: 'PGRST116' }, 406)).toBe(false);
    expect(isRetryableError({}, undefined)).toBe(true);
  });
  it('initial finish on 503 queues', async () => {
    const send: CompleteSend = async () => ({ ok: false, retryable: isRetryableError({ code: '' }, 503) });
    const pc = createPendingCompletions(mem(), send, async () => 'u1');
    expect(await pc.complete(I('a'))).toEqual({ status: 'queued' });
  });
  it('initial finish on 403/42501 is rejected, not queued', async () => {
    const send: CompleteSend = async () => ({ ok: false, retryable: isRetryableError({ code: '42501' }, 403), message: 'denied' });
    const pc = createPendingCompletions(mem(), send, async () => 'u1');
    expect((await pc.complete(I('a'))).status).toBe('rejected');
    expect(await pc.pending()).toEqual([]);
  });
  it('replay keeps on 503 / PGRST001, drops on 403 / 42501', async () => {
    const results = [
      { ok: false, retryable: isRetryableError({ code: '' }, 503) },
      { ok: false, retryable: isRetryableError({ code: 'PGRST001' }, 400) },
      { ok: false, retryable: isRetryableError({ code: '42501' }, 403) },
    ];
    const st = mem();
    const pc0 = createPendingCompletions(st, async () => NET, async () => 'u1');
    await pc0.complete(I('a'));
    await pc0.complete(I('b'));
    await pc0.complete(I('c'));
    const pc = createPendingCompletions(st, async p => results[['a', 'b', 'c'].indexOf(p.workoutInstanceId)], async () => 'u1');
    await pc.flush();
    expect((await pc.pending()).map(x => x.workoutInstanceId)).toEqual(['a', 'b']);
  });
  it('real syncAll runs completions only after the set flush settles (even on failure)', async () => {
    const order: string[] = [];
    const outbox = { flush: () => new Promise<number>((_, rej) => setTimeout(() => { order.push('sets'); rej(new Error('x')); }, 5)) };
    const pending = { flush: async () => { order.push('status'); return 0; } };
    await createSyncAll(outbox as any, pending)();
    expect(order).toEqual(['sets', 'status']);
  });
});
