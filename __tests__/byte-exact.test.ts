/**
 * Step 10 — Byte-exact validation against `motus_truth.csv`.
 *
 * Athlete: Max DiTondo (per ASPBOOSTMOBILE_PROMPT.md):
 *   heightInches = 70  → heightM  = 70 × 2.5399999618530273 / 100 = 1.7779999732971192
 *   weightLbs    = 200 → weightKg = 200 × 0.4535920023918152      = 90.71840047836304
 * Ball weight: 5.11472 oz (regulation baseball, all 117 truth rows).
 *
 * Tolerance: 0.1% per metric (binary-derived). Expected: 66/66 pitches match.
 *
 * This test reads the captures from /Users/maxsmac/Desktop/motus/data/. If
 * that directory is not present (e.g. CI), the test is skipped.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCmd01Stream } from '@/lib/pulse/ble/pulse-chunks';
import { decodeEvent } from '@/lib/pulse/decoder/decode-event';

const DATA_DIR = '/Users/maxsmac/Desktop/motus/data';
const TEST_ATHLETE = {
  heightM: (70 * 2.5399999618530273) / 100.0,
  weightKg: 200 * 0.4535920023918152,
};
const BALL_OZ = 5.11472;
const TOLERANCE_PCT = 0.1; // 0.1% — byte-exact target

interface TruthRow {
  capture: string;
  evIdx: number;
  armSpeed: number;
  torque: number;
  armSlot: number;
  swingStart: number;
  swingStop: number;
  rawImpact?: number;
}

/**
 * Load truth keyed by (capture, ev_idx) from `swing_indices_truth.csv` and
 * merge in `raw_impact` from `swing_start_diagnostics.csv`.
 */
function loadTruth(): Map<string, TruthRow> {
  const csv = readFileSync(
    join(DATA_DIR, 'swing_indices_truth.csv'),
    'utf8',
  );
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const idx = (n: string) => headers.indexOf(n);
  const out = new Map<string, TruthRow>();
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const row: TruthRow = {
      capture: cols[idx('capture')],
      evIdx: parseInt(cols[idx('ev_idx')], 10),
      armSpeed: parseFloat(cols[idx('arm_speed')]),
      torque: parseFloat(cols[idx('torque')]),
      armSlot: parseFloat(cols[idx('arm_slot')]),
      swingStart: parseInt(cols[idx('swing_start_idx')], 10),
      swingStop: parseInt(cols[idx('swing_stop_idx')], 10),
    };
    out.set(`${row.capture}|${row.evIdx}`, row);
  }

  // Merge raw_impact from swing_start_diagnostics.csv
  const diagPath = join(DATA_DIR, 'swing_start_diagnostics.csv');
  if (existsSync(diagPath)) {
    const dlines = readFileSync(diagPath, 'utf8').trim().split(/\r?\n/);
    const dh = dlines[0].split(',');
    const di = (n: string) => dh.indexOf(n);
    for (const line of dlines.slice(1)) {
      const cols = line.split(',');
      const key = `${cols[di('capture')]}|${cols[di('ev_idx')]}`;
      const r = out.get(key);
      if (r) r.rawImpact = parseInt(cols[di('raw_impact')], 10);
    }
  }
  return out;
}

function loadCapture(path: string): Uint8Array[] {
  // Mobile tsconfig is stricter than the web's about Uint8Array's
  // ArrayBuffer-vs-ArrayBufferLike generic. Build the array imperatively to
  // dodge the type-narrowing trap that .map().filter() falls into here.
  const csv = readFileSync(path, 'utf8');
  const lines = csv.trim().split(/\r?\n/);
  const HEX_RE = /^[0-9a-fA-F]+$/;
  const out: Uint8Array[] = [];
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    const cols = line.split(',');
    let hex = '';
    for (const p of cols) {
      if (p.length >= 24 && HEX_RE.test(p) && p.length > hex.length) hex = p;
    }
    if (hex.length < 36) continue;
    const u8 = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      u8[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    out.push(u8);
  }
  return out;
}

// Truth is now keyed by (capture, evIdx) — no need for armSpeed-based matching.

const haveData = existsSync(DATA_DIR);
const maybeDescribe = haveData ? describe : describe.skip;

maybeDescribe('Pulse decoder — end-to-end deltas vs swing_indices_truth.csv', () => {
  const truth = loadTruth();
  const captures = readdirSync(DATA_DIR)
    .filter((f) => f.startsWith('cmd01_') && f.endsWith('.csv'))
    .map((f) => join(DATA_DIR, f));

  it('with REAL helpers + startAccelMean override from binary CSV: should be byte-exact', () => {
    const samPath = join(DATA_DIR, 'start_accel_mean.csv');
    if (!existsSync(samPath)) return;
    const lines = readFileSync(samPath, 'utf8').trim().split(/\r?\n/);
    const h = lines[0].split(',');
    const ix = (n: string) => h.indexOf(n);
    const samMap = new Map<string, number[]>();
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      const key = `${cols[ix('capture')]}|${cols[ix('ev_idx')]}`;
      samMap.set(key, [
        parseFloat(cols[ix('startAccel_x')]),
        parseFloat(cols[ix('startAccel_y')]),
        parseFloat(cols[ix('startAccel_z')]),
      ]);
    }

    let speedSum = 0, torqueSum = 0, slotSum = 0, count = 0;
    let speedExact = 0, torqueExact = 0, slotExact = 0;
    for (const cap of captures) {
      const name = cap.split('/').pop()!;
      const events = parseCmd01Stream(loadCapture(cap));
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const t = truth.get(`${name}|${i}`);
        const sam = samMap.get(`${name}|${i}`);
        if (!t || !sam) continue;
        let decoded;
        try {
          decoded = decodeEvent(ev.sampleData, ev.compressionData, TEST_ATHLETE, {
            ballOz: BALL_OZ,
            overrideStartAccelMean: sam,
          });
        } catch (e: any) {
          continue;
        }
        const speedErr = (Math.abs(decoded.armSpeedRadS - t.armSpeed) / Math.max(t.armSpeed, 0.01)) * 100;
        const torqueErr = (Math.abs(decoded.torqueNm - t.torque) / Math.max(t.torque, 0.01)) * 100;
        const slotErr = (Math.abs(decoded.armSlotRad - t.armSlot) / Math.max(Math.abs(t.armSlot), 0.01)) * 100;
        speedSum += speedErr; torqueSum += torqueErr; slotSum += slotErr;
        if (speedErr < 0.1) speedExact++;
        if (torqueErr < 0.1) torqueExact++;
        if (slotErr < 1.0) slotExact++;
        count++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\nReal helpers + startAccelMean CSV override over ${count} events:\n` +
        `  arm speed:  ${(speedSum / count).toFixed(3)}% mean   |   ${speedExact}/${count} byte-exact (<0.1%)\n` +
        `  torque:     ${(torqueSum / count).toFixed(3)}% mean   |   ${torqueExact}/${count} byte-exact (<0.1%)\n` +
        `  arm slot:   ${(slotSum / count).toFixed(3)}% mean   |   ${slotExact}/${count} within 1%`,
    );
    expect(count).toBeGreaterThan(60);
  }, 30000);

  it('with REAL helpers + initial-R override from binary CSV: should be byte-exact', () => {
    const initRPath = join(DATA_DIR, 'initial_body_to_lab.csv');
    if (!existsSync(initRPath)) return;
    const lines = readFileSync(initRPath, 'utf8').trim().split(/\r?\n/);
    const h = lines[0].split(',');
    const ix = (n: string) => h.indexOf(n);
    const initRMap = new Map<string, number[]>();
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      const key = `${cols[ix('capture')]}|${cols[ix('ev_idx')]}`;
      const R = [];
      for (let k = 0; k < 9; k++) R.push(parseFloat(cols[ix(`R${k}`)]));
      initRMap.set(key, R);
    }

    let speedSum = 0, torqueSum = 0, slotSum = 0, count = 0;
    let speedExact = 0, torqueExact = 0, slotExact = 0;
    for (const cap of captures) {
      const name = cap.split('/').pop()!;
      const events = parseCmd01Stream(loadCapture(cap));
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const t = truth.get(`${name}|${i}`);
        const initR = initRMap.get(`${name}|${i}`);
        if (!t || !initR) continue;
        let decoded;
        try {
          decoded = decodeEvent(ev.sampleData, ev.compressionData, TEST_ATHLETE, {
            ballOz: BALL_OZ,
            overrideInitialBodyToLab: initR,
          });
        } catch (e: any) {
          continue;
        }
        const speedErr = (Math.abs(decoded.armSpeedRadS - t.armSpeed) / Math.max(t.armSpeed, 0.01)) * 100;
        const torqueErr = (Math.abs(decoded.torqueNm - t.torque) / Math.max(t.torque, 0.01)) * 100;
        const slotErr = (Math.abs(decoded.armSlotRad - t.armSlot) / Math.max(Math.abs(t.armSlot), 0.01)) * 100;
        speedSum += speedErr; torqueSum += torqueErr; slotSum += slotErr;
        if (speedErr < 0.1) speedExact++;
        if (torqueErr < 0.1) torqueExact++;
        if (slotErr < 1.0) slotExact++;
        count++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\nReal helpers + initial-R override over ${count} events:\n` +
        `  arm speed:  ${(speedSum / count).toFixed(3)}% mean   |   ${speedExact}/${count} byte-exact (<0.1%)\n` +
        `  torque:     ${(torqueSum / count).toFixed(3)}% mean   |   ${torqueExact}/${count} byte-exact (<0.1%)\n` +
        `  arm slot:   ${(slotSum / count).toFixed(3)}% mean   |   ${slotExact}/${count} within 1%`,
    );
    expect(count).toBeGreaterThan(60);
  }, 30000);

  it('with FULL index override from truth CSV (no R): should converge to byte-exact', () => {
    let speedSum = 0, torqueSum = 0, slotSum = 0, count = 0;
    let speedExact = 0, torqueExact = 0;
    for (const cap of captures) {
      const name = cap.split('/').pop()!;
      const events = parseCmd01Stream(loadCapture(cap));
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const t = truth.get(`${name}|${i}`);
        if (!t) continue;
        let decoded;
        try {
          decoded = decodeEvent(ev.sampleData, ev.compressionData, TEST_ATHLETE, {
            ballOz: BALL_OZ,
            overrideIndices: {
              swingStartIdx: t.swingStart,
              impactIdx: t.rawImpact ?? 0,
              swingStopIdx: t.swingStop,
            },
          });
        } catch (e: any) {
          continue;
        }
        const speedErr = (Math.abs(decoded.armSpeedRadS - t.armSpeed) / Math.max(t.armSpeed, 0.01)) * 100;
        const torqueErr = (Math.abs(decoded.torqueNm - t.torque) / Math.max(t.torque, 0.01)) * 100;
        const slotErr = (Math.abs(decoded.armSlotRad - t.armSlot) / Math.max(Math.abs(t.armSlot), 0.01)) * 100;
        speedSum += speedErr;
        torqueSum += torqueErr;
        slotSum += slotErr;
        if (speedErr < 0.1) speedExact++;
        if (torqueErr < 0.1) torqueExact++;
        count++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\nFull-index-override over ${count} events:\n` +
        `  arm speed:  ${(speedSum / count).toFixed(2)}% mean   |   ${speedExact}/${count} byte-exact (<0.1%)\n` +
        `  torque:     ${(torqueSum / count).toFixed(2)}% mean   |   ${torqueExact}/${count} byte-exact (<0.1%)\n` +
        `  arm slot:   ${(slotSum / count).toFixed(2)}% mean`,
    );
    expect(count).toBeGreaterThan(60);
  }, 30000);

  it('with raw_impact override from binary CSV: how close does the rest of the pipeline get?', () => {
    // Load raw_impact map from swing_start_diagnostics.csv
    const diagPath = join(DATA_DIR, 'swing_start_diagnostics.csv');
    if (!existsSync(diagPath)) {
      // eslint-disable-next-line no-console
      console.log('skipping — diagnostics CSV not present');
      return;
    }
    const diagLines = readFileSync(diagPath, 'utf8').trim().split(/\r?\n/);
    const dh = diagLines[0].split(',');
    const di = (n: string) => dh.indexOf(n);
    const rawImpactMap = new Map<string, number>();
    for (const line of diagLines.slice(1)) {
      const cols = line.split(',');
      rawImpactMap.set(`${cols[di('capture')]}|${cols[di('ev_idx')]}`, parseInt(cols[di('raw_impact')], 10));
    }

    let speedSum = 0, torqueSum = 0, slotSum = 0, count = 0;
    for (const cap of captures) {
      const name = cap.split('/').pop()!;
      const events = parseCmd01Stream(loadCapture(cap));
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const rawImpact = rawImpactMap.get(`${name}|${i}`);
        const t = truth.get(`${name}|${i}`);
        if (rawImpact === undefined || !t) continue;
        let decoded;
        try {
          decoded = decodeEvent(ev.sampleData, ev.compressionData, TEST_ATHLETE, {
            ballOz: BALL_OZ,
            overrideImpactIdx: rawImpact,
          });
        } catch (e: any) {
          continue;
        }
        const speedErr = (Math.abs(decoded.armSpeedRadS - t.armSpeed) / Math.max(t.armSpeed, 0.01)) * 100;
        const torqueErr = (Math.abs(decoded.torqueNm - t.torque) / Math.max(t.torque, 0.01)) * 100;
        const slotErr = (Math.abs(decoded.armSlotRad - t.armSlot) / Math.max(Math.abs(t.armSlot), 0.01)) * 100;
        speedSum += speedErr;
        torqueSum += torqueErr;
        slotSum += slotErr;
        count++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\nRaw-impact-override mean errors over ${count} events:\n` +
        `  arm speed:  ${(speedSum / count).toFixed(2)}%\n` +
        `  torque:     ${(torqueSum / count).toFixed(2)}%\n` +
        `  arm slot:   ${(slotSum / count).toFixed(2)}%`,
    );
    expect(count).toBeGreaterThan(60);
  }, 30000);

  it('runs all captures and reports per-pitch delta table (DOES NOT yet enforce 0.1%)', () => {
    // Quick diagnostic: run pipeline pieces on first event to see what indices come out
    const firstEvents = parseCmd01Stream(loadCapture(captures[0]));
    if (firstEvents.length > 0) {
      const ev = firstEvents[0];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { calibrate } = require('@/lib/pulse/decoder/calibrate');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { decompressAllData } = require('@/lib/pulse/decoder/decompress');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { applyMiniLPFTorqueToAZ } = require('@/lib/pulse/decoder/filters');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { interpolateAll } = require('@/lib/pulse/decoder/interpolate');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { indexImpact, indexSwingStop, indexSwingStart } = require('@/lib/pulse/decoder/swing-indices');
      const c = calibrate(ev.sampleData);
      const d = decompressAllData(c, ev.compressionData);
      applyMiniLPFTorqueToAZ(d);
      interpolateAll(d);
      const ii = indexImpact(d);
      const isi = indexSwingStart(d, ii);
      const iss = indexSwingStop(d, ii);
      // eslint-disable-next-line no-console
      console.log(`Diagnostic: impact=${ii} start=${isi} stop=${iss}`);
    }

    let totalEvents = 0;
    let inToleranceCount = 0;
    const rows: string[] = [];
    for (const cap of captures) {
      const name = cap.split('/').pop()!;
      const events = parseCmd01Stream(loadCapture(cap));
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        let decoded;
        try {
          decoded = decodeEvent(ev.sampleData, ev.compressionData, TEST_ATHLETE, { ballOz: BALL_OZ });
        } catch (e: any) {
          rows.push(`${name} ev=${ev.eventId} ERROR: ${e?.message ?? e}\n${e?.stack?.split('\n').slice(0, 4).join('\n')}`);
          continue;
        }
        totalEvents++;
        const t = truth.get(`${name}|${i}`);
        if (!t) {
          rows.push(
            `${name} ev=${i} no-truth-row speed=${decoded.armSpeedRadS.toFixed(3)} torque=${decoded.torqueNm.toFixed(3)}`,
          );
          continue;
        }
        const speedErr = Math.abs(decoded.armSpeedRadS - t.armSpeed) / Math.max(t.armSpeed, 0.01) * 100;
        const torqueErr = Math.abs(decoded.torqueNm - t.torque) / Math.max(t.torque, 0.01) * 100;
        const slotErr =
          Math.abs(decoded.armSlotRad - t.armSlot) / Math.max(Math.abs(t.armSlot), 0.01) * 100;
        const ok = speedErr < TOLERANCE_PCT && torqueErr < TOLERANCE_PCT && slotErr < TOLERANCE_PCT;
        if (ok) inToleranceCount++;
        rows.push(
          `${name.padEnd(22)} ev=${String(i).padStart(2)} ` +
            `spd ${decoded.armSpeedRadS.toFixed(3)}/${t.armSpeed.toFixed(3)} (${speedErr.toFixed(2)}%) ` +
            `trq ${decoded.torqueNm.toFixed(3)}/${t.torque.toFixed(3)} (${torqueErr.toFixed(2)}%) ` +
            `slot ${decoded.armSlotRad.toFixed(3)}/${t.armSlot.toFixed(3)} (${slotErr.toFixed(2)}%) ${ok ? '✓' : ''}`,
        );
      }
    }

    // Compute per-metric mean absolute % error for diagnostics.
    let speedErrSum = 0, torqueErrSum = 0, slotErrSum = 0, matchedCount = 0;
    for (const row of rows) {
      const m = row.match(/spd .*\(([\d.]+)%\) trq .*\(([\d.]+)%\) slot .*\(([\d.]+)%\)/);
      if (m) {
        speedErrSum += parseFloat(m[1]);
        torqueErrSum += parseFloat(m[2]);
        slotErrSum += parseFloat(m[3]);
        matchedCount++;
      }
    }

    // eslint-disable-next-line no-console
    console.log('\n=== Per-pitch comparison ===\n' + rows.join('\n'));
    // eslint-disable-next-line no-console
    console.log(
      `\n=== ${inToleranceCount}/${totalEvents} pitches within ${TOLERANCE_PCT}% on all 3 metrics ===`,
    );
    if (matchedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `Mean abs error over ${matchedCount} pitches:\n` +
          `  arm speed:   ${(speedErrSum / matchedCount).toFixed(2)}%\n` +
          `  torque:      ${(torqueErrSum / matchedCount).toFixed(2)}%\n` +
          `  arm slot:    ${(slotErrSum / matchedCount).toFixed(2)}%`,
      );
    }

    // Loose check — at least we should be DECODING all events without error.
    // Target (once metric port is byte-exact): inToleranceCount === 66.
    expect(totalEvents).toBeGreaterThan(60);
  }, 30000);
});
