/**
 * E2E collab integration tests — real HeadlessEngine + WS sidecar + real
 * collab server.
 *
 * Creates real HeadlessEngine instances, attaches WS sidecars, and verifies
 * that cell-level edits propagate through the full stack:
 *   engine.workbook.activeSheet.setCell → computeBridge.subscribeUpdateV1 →
 *   ws-sidecar PUSH → collab server → BROADCAST_NUDGE → ws-sidecar →
 *   computeBridge.syncApply → Yrs CRDT state
 *
 * Cell values on the receiving engine are verified through workbook/bridge
 * APIs. Raw Yrs snapshot inspection is reserved for failure diagnostics.
 *
 * Test matrix (from mog-web-collaboration-e2e.md prefetcha):
 *   Tier 1 (must-pass):
 *     - hello-world: A sets A1=42, B sees 42
 *     - bidirectional: A sets A1=1, B sets B1=2, both see both
 *     - concurrent-same-cell: both write A1, both converge to same value
 *     - large-batch: A writes 100 cells, B sees all 100
 *     - reconnect: A detaches, B edits, A reattaches and catches up
 *
 *   Tier 2 (should-pass):
 *     - three-peers: edits from A propagate to B and C
 *     - late-join: A edits extensively, B joins 2s later with full state
 */

import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { attachWsSidecar, fetchRoomSnapshot, type WsSidecar } from '../ws-sidecar';
import { createEventLog } from '../event-log';
import { createCollabTestLog, type CollabTestLog } from './test-log-collector';

// ---------------------------------------------------------------------------
// NAPI addon + SDK loading
// ---------------------------------------------------------------------------

const napiPkgPath = join(
  new URL('.', import.meta.url).pathname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'compute',
  'napi',
);
const esmRequire = createRequire(join(napiPkgPath, 'package.json'));
let addon: any;
try {
  addon = esmRequire(napiPkgPath);
} catch {
  // addon not built
}

const sdkPath = join(
  new URL('.', import.meta.url).pathname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'runtime',
  'sdk',
  'src',
  'boot.ts',
);

let createHeadlessEngine: any;
let createHeadlessEngineFromYrsState: any;
let _getComputeBridge: any;
try {
  const sdkMod = await import(sdkPath);
  createHeadlessEngine = sdkMod.createHeadlessEngine;
  createHeadlessEngineFromYrsState = sdkMod.createHeadlessEngineFromYrsState;
  _getComputeBridge =
    sdkMod._getComputeBridge ?? ((engine: any) => engine?.lifecycle?.computeBridge);
} catch {
  // SDK not loadable
}

// Check that the NAPI binary has the methods we need
const hasEngineSupport =
  addon &&
  createHeadlessEngine &&
  createHeadlessEngineFromYrsState &&
  _getComputeBridge &&
  typeof addon.yrs_state_to_snapshot_json === 'function';

const describeWithEngine = hasEngineSupport ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SERVER_ENTRY = join(
  new URL('.', import.meta.url).pathname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'runtime',
  'server',
  'src',
  'index.ts',
);
const hasCollabServer = existsSync(SERVER_ENTRY);

const describeWithCollabStack = hasEngineSupport && hasCollabServer ? describe : describe.skip;

async function getFreePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function startServer(
  wsPort: number,
  healthPort: number,
  testLog?: CollabTestLog,
): Promise<ChildProcess> {
  const proc = spawn('npx', ['tsx', SERVER_ENTRY], {
    env: {
      ...process.env,
      WS_PORT: String(wsPort),
      HEALTH_PORT: String(healthPort),
      MOG_COLLAB_TEST_PRESEED: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Capture server stderr for diagnostics
  proc.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      testLog?.addServerLine(line);
    }
  });

  const healthUrl = `http://localhost:${healthPort}/health`;
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(healthUrl);
      if (resp.ok) return proc;
    } catch {
      // not ready yet
    }
    if (proc.exitCode !== null) {
      throw new Error(`Server exited with code ${proc.exitCode}`);
    }
    await sleep(200);
  }

  proc.kill();
  throw new Error("Server didn't become healthy in 15s");
}

async function stopServer(proc: ChildProcess | null): Promise<void> {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      proc.stdin?.destroy();
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      resolve();
    };
    const killTimer = setTimeout(() => {
      proc.kill('SIGKILL');
    }, 5_000);

    proc.once('close', finish);
    proc.once('exit', finish);
    if (!proc.kill('SIGTERM')) {
      finish();
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface RoomStateBootstrap {
  fullState: Uint8Array;
  coordinatorSv: Uint8Array;
  roomEpoch: number;
  fullStateHash: string;
  snapshotToken: string;
}

const preseededRooms = new Set<string>();

async function preseedBlankRoom(healthPort: number, roomId: string): Promise<void> {
  if (preseededRooms.has(roomId)) return;

  const resp = await fetch(
    `http://localhost:${healthPort}/__test__/rooms/${encodeURIComponent(roomId)}/preseed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'blank' }),
    },
  );
  if (!resp.ok) {
    throw new Error(`Failed to preseed test room ${roomId}: ${resp.status} ${await resp.text()}`);
  }

  preseededRooms.add(roomId);
}

async function fetchRoomStateBootstrap(
  wsPort: number,
  healthPort: number,
  roomId: string,
): Promise<RoomStateBootstrap> {
  await preseedBlankRoom(healthPort, roomId);
  const snapshot = await fetchRoomSnapshot(`ws://localhost:${wsPort}/${roomId}`, roomId);
  return {
    fullState: snapshot.fullState,
    coordinatorSv: snapshot.stateVector,
    roomEpoch: snapshot.roomEpoch,
    fullStateHash: snapshot.fullStateHash,
    snapshotToken: snapshot.snapshotToken,
  };
}

// ---------------------------------------------------------------------------
// Engine fixture
// ---------------------------------------------------------------------------

interface EngineFixture {
  engine: any;
  bridge: any;
  sidecar: WsSidecar | null;
  roomState?: RoomStateBootstrap;
}

async function makeEngine(
  wsPort: number,
  healthPort: number,
  roomId: string,
): Promise<EngineFixture> {
  const roomState = await fetchRoomStateBootstrap(wsPort, healthPort, roomId);
  const engine = await createHeadlessEngineFromYrsState(addon, roomState.fullState);
  const bridge = _getComputeBridge(engine);
  return { engine, bridge, sidecar: null, roomState };
}

async function attach(
  f: EngineFixture,
  wsPort: number,
  healthPort: number,
  roomId: string,
  pid: string,
  testLog?: CollabTestLog,
): Promise<void> {
  const roomState = await fetchRoomStateBootstrap(wsPort, healthPort, roomId);
  f.roomState = roomState;
  const eventLog = testLog ? createEventLog() : undefined;
  f.sidecar = await attachWsSidecar({
    url: `ws://localhost:${wsPort}/${roomId}`,
    participantId: pid,
    computeBridge: f.bridge,
    preflightStateVector: roomState.coordinatorSv,
    preflightRoomEpoch: roomState.roomEpoch,
    preflightFullStateHash: roomState.fullStateHash,
    preflightSnapshotToken: roomState.snapshotToken,
    eventLog,
  });
  if (testLog && eventLog) {
    testLog.addSidecar(pid, eventLog, () => f.sidecar?.status ?? 'offline');
  }
}

/** Parse A1-style ref to 0-based {row, col}. */
function parseRef(ref: string): { row: number; col: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`Invalid ref: ${ref}`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: parseInt(m[2], 10) - 1, col: col - 1 };
}

/**
 * Read a single cell value from the engine through the compute-visible cell
 * index. Raw Yrs snapshots are diagnostics only in this suite.
 */
async function readCellValue(f: EngineFixture, ref: string): Promise<unknown> {
  const { row, col } = parseRef(ref);
  const sheetId = f.engine.activeSheetId;

  // Primary: getCellData reads from the compute engine's cell index.
  // Works for locally-written cells.
  const cellData = await f.bridge.getCellData(sheetId as any, row, col);
  if (cellData) {
    // Formula cells have a `formula` field instead of `raw`.
    const cd = cellData as any;
    if (cd.formula != null) return `=${cd.formula}`;
    if (cd.raw != null) {
      if (typeof cd.raw === 'object' && cd.raw.value !== undefined) return cd.raw.value;
      return cd.raw;
    }
  }

  return undefined;
}

async function snapshotDiagnostics(f: EngineFixture): Promise<any> {
  const core = (f.bridge as any).core;
  const fullState = await core.syncFullState();
  return JSON.parse(addon.yrs_state_to_snapshot_json(Buffer.from(fullState)));
}

/** Wait for a cell to converge to expected value on a fixture. */
async function waitForCell(
  f: EngineFixture,
  ref: string,
  expected: unknown,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await readCellValue(f, ref);
    if (val === expected) return;
    await sleep(250);
  }
  const actual = await readCellValue(f, ref);
  const snap = await snapshotDiagnostics(f);
  console.error(
    `Cell ${ref} did not become ${String(expected)} through bridge APIs. Snapshot diagnostics: ${JSON.stringify(snap)}`,
  );
  expect(actual).toBe(expected);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeWithCollabStack('Collab E2E — real engines + WS sidecar', () => {
  let serverProc: ChildProcess | null = null;
  let wsPort: number;
  let healthPort: number;
  let testLog: CollabTestLog;
  const fixtures: EngineFixture[] = [];

  beforeAll(async () => {
    testLog = createCollabTestLog();
    wsPort = await getFreePort();
    healthPort = await getFreePort();
    serverProc = await startServer(wsPort, healthPort, testLog);
  }, 30_000);

  afterAll(async () => {
    if (serverProc) {
      await stopServer(serverProc);
      serverProc = null;
    }
  });

  afterEach(async () => {
    // Dump diagnostics if test failed
    const state = expect.getState();
    if (state.numPassingAsserts === 0 && state.assertionCalls > 0) {
      const diag = testLog.diagnostics();
      console.error('\n=== COLLAB E2E FAILURE DIAGNOSTICS ===');
      console.error(diag.timeline);
      console.error('\n--- Sidecar Stats ---');
      for (const [label, stats] of Object.entries(diag.sidecarStats)) {
        console.error(
          `${label}: sent=${JSON.stringify(stats.sent)} recv=${JSON.stringify(stats.received)}`,
        );
      }
      console.error('\n--- Sidecar Status ---');
      for (const [label, status] of Object.entries(diag.sidecarStatus)) {
        console.error(`${label}: ${status}`);
      }
      console.error('=== END DIAGNOSTICS ===\n');
    }

    // Detach all sidecars first — they hold refs to the compute bridge
    // and will call syncDiff/syncApply on incoming messages.
    for (const f of [...fixtures]) {
      try {
        f.sidecar?.detach();
        f.sidecar = null;
      } catch {
        /* */
      }
    }

    // Destroy each compute bridge to stop the setTimeout(tick,0) polling loop.
    // Must be awaited — the polling loop may have an in-flight NAPI call.
    for (const f of fixtures) {
      try {
        await f.bridge.destroy();
      } catch {
        /* */
      }
    }

    // Engine dispose is fire-and-forget — bridge is already destroyed.
    for (const f of fixtures) {
      try {
        f.engine.dispose();
      } catch {
        /* */
      }
    }

    fixtures.length = 0;
    testLog.clear();
  });

  // ── Tier 1: must-pass ──

  test('room-state boot: engine has no local bootstrap diff before attach', async () => {
    const room = `e2e-room-bootstrap-${Date.now()}`;
    const bootstrap = await fetchRoomStateBootstrap(wsPort, healthPort, room);
    const engine = await createHeadlessEngineFromYrsState(addon, bootstrap.fullState);
    const bridge = _getComputeBridge(engine);
    const fixture = { engine, bridge, sidecar: null, roomState: bootstrap };
    fixtures.push(fixture);

    const diff = await bridge.core.syncDiff(bootstrap.coordinatorSv);
    // Yrs may encode an empty update as a tiny two-byte payload; a local
    // default-sheet bootstrap would be a substantive schema diff.
    expect(diff.byteLength).toBeLessThanOrEqual(2);
  }, 30_000);

  test('hello-world: A sets A1=42, B sees 42', async () => {
    const room = `e2e-hello-${Date.now()}`;
    const a = await makeEngine(wsPort, healthPort, room);
    const b = await makeEngine(wsPort, healthPort, room);
    fixtures.push(a, b);

    await attach(a, wsPort, healthPort, room, 'user-a', testLog);
    await attach(b, wsPort, healthPort, room, 'user-b', testLog);

    await a.engine.workbook.activeSheet.setCell('A1', 42);

    await waitForCell(b, 'A1', 42);
  }, 30_000);

  test('bidirectional: A sets A1=1, B sets B1=2, both see both', async () => {
    const room = `e2e-bidi-${Date.now()}`;
    const a = await makeEngine(wsPort, healthPort, room);
    const b = await makeEngine(wsPort, healthPort, room);
    fixtures.push(a, b);

    await attach(a, wsPort, healthPort, room, 'user-a', testLog);
    await attach(b, wsPort, healthPort, room, 'user-b', testLog);

    await a.engine.workbook.activeSheet.setCell('A1', 1);
    await sleep(500);
    await b.engine.workbook.activeSheet.setCell('B1', 2);

    await waitForCell(b, 'A1', 1);
    await waitForCell(a, 'B1', 2);
  }, 30_000);

  test('concurrent-same-cell: both write A1, both converge to same value', async () => {
    const room = `e2e-concurrent-${Date.now()}`;
    const a = await makeEngine(wsPort, healthPort, room);
    const b = await makeEngine(wsPort, healthPort, room);
    fixtures.push(a, b);

    await attach(a, wsPort, healthPort, room, 'user-a', testLog);
    await attach(b, wsPort, healthPort, room, 'user-b', testLog);

    // Both write A1 near-simultaneously
    await a.engine.workbook.activeSheet.setCell('A1', 'from-A');
    await b.engine.workbook.activeSheet.setCell('A1', 'from-B');

    // Wait for convergence
    await sleep(3000);

    const valA = await readCellValue(a, 'A1');
    const valB = await readCellValue(b, 'A1');
    // CRDT last-write-wins — both must converge to the same value
    expect(valA).toBe(valB);
    // Value should be one of the two writes
    expect(['from-A', 'from-B']).toContain(valA);
  }, 30_000);

  test('large-batch: A writes 100 cells, B sees all 100', async () => {
    const room = `e2e-batch-${Date.now()}`;
    const a = await makeEngine(wsPort, healthPort, room);
    const b = await makeEngine(wsPort, healthPort, room);
    fixtures.push(a, b);

    await attach(a, wsPort, healthPort, room, 'user-a', testLog);
    await attach(b, wsPort, healthPort, room, 'user-b', testLog);

    const ws = a.engine.workbook.activeSheet;
    for (let i = 1; i <= 100; i++) {
      await ws.setCell(`A${i}`, i);
    }

    // Wait for convergence using getCellData-based readCellValue
    const deadline = Date.now() + 15_000;
    let matches = 0;
    while (Date.now() < deadline) {
      matches = 0;
      for (let i = 1; i <= 100; i++) {
        const val = await readCellValue(b, `A${i}`);
        if (val === i) matches++;
      }
      if (matches >= 100) break;
      await sleep(500);
    }

    expect(matches).toBe(100);
  }, 30_000);

  test('reconnect: A detaches, B edits, A reattaches and catches up', async () => {
    const room = `e2e-reconnect-${Date.now()}`;
    const a = await makeEngine(wsPort, healthPort, room);
    const b = await makeEngine(wsPort, healthPort, room);
    fixtures.push(a, b);

    await attach(a, wsPort, healthPort, room, 'user-a', testLog);
    await attach(b, wsPort, healthPort, room, 'user-b', testLog);

    // A writes initial value
    await a.engine.workbook.activeSheet.setCell('A1', 'before');
    await waitForCell(b, 'A1', 'before');

    // A detaches
    a.sidecar!.detach();
    a.sidecar = null;

    // B edits while A is disconnected
    await b.engine.workbook.activeSheet.setCell('A2', 'while-offline');
    await sleep(500);

    // A reattaches — should receive B's edit from JOIN handshake
    await attach(a, wsPort, healthPort, room, 'user-a-reconnect', testLog);

    await waitForCell(a, 'A2', 'while-offline');
  }, 30_000);

  // ── Tier 2: should-pass ──

  test('three-peers: edits from A propagate to B and C', async () => {
    const room = `e2e-three-${Date.now()}`;
    const a = await makeEngine(wsPort, healthPort, room);
    const b = await makeEngine(wsPort, healthPort, room);
    const c = await makeEngine(wsPort, healthPort, room);
    fixtures.push(a, b, c);

    await attach(a, wsPort, healthPort, room, 'user-a', testLog);
    await attach(b, wsPort, healthPort, room, 'user-b', testLog);
    await attach(c, wsPort, healthPort, room, 'user-c', testLog);

    await a.engine.workbook.activeSheet.setCell('A1', 'from-a');

    await waitForCell(b, 'A1', 'from-a');
    await waitForCell(c, 'A1', 'from-a');
  }, 30_000);

  test('late-join: A edits, B joins 2s later and receives full state', async () => {
    const room = `e2e-late-${Date.now()}`;
    const a = await makeEngine(wsPort, healthPort, room);
    fixtures.push(a);

    await attach(a, wsPort, healthPort, room, 'user-a', testLog);

    await a.engine.workbook.activeSheet.setCell('A1', 'first');
    await a.engine.workbook.activeSheet.setCell('A2', 'second');
    await a.engine.workbook.activeSheet.setCell('A3', 'third');

    await sleep(2_000);

    // B joins late
    const b = await makeEngine(wsPort, healthPort, room);
    fixtures.push(b);
    await attach(b, wsPort, healthPort, room, 'user-b', testLog);

    await waitForCell(b, 'A1', 'first');
    await waitForCell(b, 'A2', 'second');
    await waitForCell(b, 'A3', 'third');
  }, 30_000);

  // ── Tier 3: structural sync (documents current workbook API cache gap) ──
  // These tests verify that structural mutations (sheet create, sheet rename,
  // merge cells) propagate to remote peers through the full collab stack.
  //
  // The underlying Yrs CRDT state DOES converge (binary updates are applied),
  // but the MutationResult returned by rebuild_from_yrs_after_sync is empty
  // for structural fields — so the TS layer never fires domain events and the
  // workbook API objects stay stale.
  //
  // The underlying Yrs CRDT state converges, but the workbook API caches do
  // not yet refresh to expose remote sheet lifecycle / merge metadata.
  // Mirror coverage of collab-sync-mutation-result-audit.md.

  test.skip('structural sync: sheet create seen by peer', async () => {
    const room = `e2e-sheet-create-${Date.now()}`;
    const a = await makeEngine(wsPort, healthPort, room);
    const b = await makeEngine(wsPort, healthPort, room);
    fixtures.push(a, b);

    await attach(a, wsPort, healthPort, room, 'user-a', testLog);
    await attach(b, wsPort, healthPort, room, 'user-b', testLog);

    // Both engines start with 1 sheet ("Sheet1")
    expect(a.engine.workbook.sheetCount).toBe(1);
    expect(b.engine.workbook.sheetCount).toBe(1);

    // A creates a second sheet
    await a.engine.workbook.sheets.add('Sheet2');
    expect(a.engine.workbook.sheetCount).toBe(2);

    // Wait for B to see the new sheet via the workbook API.
    // This requires MutationResult.sheet_changes to be populated so the
    // MutationResultHandler fires sheet events and refreshes metadata.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (b.engine.workbook.sheetCount >= 2) break;
      await sleep(250);
    }

    if (b.engine.workbook.sheetCount < 2) {
      const snap = await snapshotDiagnostics(b);
      console.error(
        `Sheet create was not visible through workbook APIs. Snapshot diagnostics: ${JSON.stringify(snap)}`,
      );
    }

    // Primary assertion: B's workbook API reflects the new sheet
    expect(b.engine.workbook.sheetCount).toBe(2);
    expect(b.engine.workbook.sheetNames).toContain('Sheet2');
  }, 30_000);

  test.skip('structural sync: sheet rename seen by peer', async () => {
    const room = `e2e-sheet-rename-${Date.now()}`;
    const a = await makeEngine(wsPort, healthPort, room);
    const b = await makeEngine(wsPort, healthPort, room);
    fixtures.push(a, b);

    await attach(a, wsPort, healthPort, room, 'user-a', testLog);
    await attach(b, wsPort, healthPort, room, 'user-b', testLog);

    // A renames the active sheet
    await a.engine.workbook.activeSheet.setName('Renamed');

    // Wait for B's workbook API to reflect the rename.
    // Requires MutationResult.sheet_changes to carry the rename event.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (b.engine.workbook.sheetNames.includes('Renamed')) break;
      await sleep(250);
    }

    if (!b.engine.workbook.sheetNames.includes('Renamed')) {
      const snap = await snapshotDiagnostics(b);
      console.error(
        `Sheet rename was not visible through workbook APIs. Snapshot diagnostics: ${JSON.stringify(snap)}`,
      );
    }

    // Primary assertion: B's workbook API shows the renamed sheet
    expect(b.engine.workbook.sheetNames).toContain('Renamed');
    expect(b.engine.workbook.sheetNames).not.toContain('Sheet1');
  }, 30_000);

  test.skip('structural sync: merge cells seen by peer', async () => {
    const room = `e2e-merge-${Date.now()}`;
    const a = await makeEngine(wsPort, healthPort, room);
    const b = await makeEngine(wsPort, healthPort, room);
    fixtures.push(a, b);

    await attach(a, wsPort, healthPort, room, 'user-a', testLog);
    await attach(b, wsPort, healthPort, room, 'user-b', testLog);

    // A merges A1:B2
    await a.engine.workbook.activeSheet.structure.merge('A1:B2');

    // Wait for B's workbook API to include the merge.
    const deadline = Date.now() + 10_000;
    let cellInfo = await b.engine.workbook.activeSheet.getCell('A1');
    while (Date.now() < deadline) {
      cellInfo = await b.engine.workbook.activeSheet.getCell('A1');
      if (cellInfo.isMerged) break;
      await sleep(250);
    }

    if (!cellInfo.isMerged) {
      const snap = await snapshotDiagnostics(b);
      console.error(
        `Merge was not visible through workbook APIs. Snapshot diagnostics: ${JSON.stringify(snap)}`,
      );
    }

    // Primary assertion: B's workbook API should also reflect the merge.
    // This requires MutationResult.merge_changes to be populated so the
    // merge index on B's engine updates. We read cell info to check merge state.
    expect(cellInfo.isMerged).toBe(true);
    expect(cellInfo.mergedRegion).toBe('A1:B2');
  }, 30_000);

  test('formula-dep: A sets A1=10, B sets B1=SUM(A1), both sync', async () => {
    const room = `e2e-formula-${Date.now()}`;
    const a = await makeEngine(wsPort, healthPort, room);
    const b = await makeEngine(wsPort, healthPort, room);
    fixtures.push(a, b);

    await attach(a, wsPort, healthPort, room, 'user-a', testLog);
    await attach(b, wsPort, healthPort, room, 'user-b', testLog);

    await a.engine.workbook.activeSheet.setCell('A1', 10);
    await waitForCell(b, 'A1', 10);

    await b.engine.workbook.activeSheet.setCell('B1', '=SUM(A1)');

    // A should see B1 synced — Yrs stores the formula string
    await waitForCell(a, 'B1', '=SUM(A1)');
  }, 30_000);
});
