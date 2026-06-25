/**
 * Integration test: WS sidecar + real collab server.
 *
 * Starts a real collab server on an ephemeral port, creates two mock
 * ComputeBridgeLike objects backed by NAPI coordinators (real Yrs CRDT
 * state), and verifies updates propagate through the sidecar ↔ server
 * ↔ sidecar round-trip.
 *
 * This test proves the browser sidecar's wire protocol, JOIN handshake,
 * PUSH flow, and BROADCAST_NUDGE handling all work against the real server.
 */

import { jest } from '@jest/globals';
import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { attachWsSidecar, ComputeBridgeLike, fetchRoomSnapshot, WsSidecar } from '../ws-sidecar';
import { createEventLog, type EventLog } from '../event-log';
import { createCollabTestLog, type CollabTestLog } from './test-log-collector';
import type { ClassifiedRawSyncUpdateProvenance } from '../../providers/provider';
import {
  createAdmittedSyncApplyContext,
  type AdmittedSyncApplyContext,
} from '../../../bridges/compute/sync-apply-admission';

// ---------------------------------------------------------------------------
// NAPI addon loading
// ---------------------------------------------------------------------------

// Resolve the NAPI addon from the compute/napi package (the kernel doesn't
// depend on it directly — this is a test-only dependency for creating real
// Yrs CRDT state).
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
  // Skip tests if addon not available (no Rust build)
}

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

const describeWithAddon = addon && hasCollabServer ? describe : describe.skip;

/** Find a free port by binding to 0 then releasing. */
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

/** Start the collab server on given ports. */
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

  // Wait for health check
  const healthUrl = `http://localhost:${healthPort}/health`;
  const deadline = Date.now() + 15_000;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(healthUrl);
      if (resp.ok) return proc;
    } catch (e) {
      lastErr = e;
    }

    // Check if server died
    if (proc.exitCode !== null) {
      throw new Error(`Server exited with code ${proc.exitCode}`);
    }

    await sleep(200);
  }

  proc.kill();
  throw new Error(`Server didn't become healthy in 15s: ${lastErr}`);
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

async function preseedBlankRoom(healthPort: number, roomId: string): Promise<void> {
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
}

function roomIdFromUrl(url: string): string {
  const roomId = new URL(url).pathname.split('/').filter(Boolean).pop();
  if (!roomId) throw new Error(`Test URL does not include a room id: ${url}`);
  return decodeURIComponent(roomId);
}

// ---------------------------------------------------------------------------
// Mock ComputeBridge backed by NAPI coordinator
//
// Each mock is a real Yrs CRDT document (via coordinator handle).
// This lets us test the sidecar with valid Yrs state vectors and updates.
// ---------------------------------------------------------------------------

interface MockBridge extends ComputeBridgeLike {
  _handle: number;
  _pid: string;
  _appliedUpdates: Uint8Array[];
  _classifiedProvenance: ClassifiedRawSyncUpdateProvenance[];
  _admittedContexts: AdmittedSyncApplyContext[];
  _updateCallbacks: Set<(update: Uint8Array) => void>;
  syncApply(update: Uint8Array, syncApplyContext?: AdmittedSyncApplyContext): Promise<unknown>;
  /** Simulate a local change by pushing another coordinator's state. */
  _simulateLocalChange(sourceHandle: number): void;
  _dispose(): void;
}

function createMockBridge(participantId: string): MockBridge {
  const handle = addon.coordinator_create();
  // Must join the coordinator before push/pull
  addon.coordinator_join(handle, participantId);

  const appliedUpdates: Uint8Array[] = [];
  const classifiedProvenance: ClassifiedRawSyncUpdateProvenance[] = [];
  const admittedContexts: AdmittedSyncApplyContext[] = [];
  const updateCallbacks = new Set<(update: Uint8Array) => void>();
  let disposed = false;

  const bridge: MockBridge = {
    _handle: handle,
    _pid: participantId,
    _appliedUpdates: appliedUpdates,
    _classifiedProvenance: classifiedProvenance,
    _admittedContexts: admittedContexts,
    _updateCallbacks: updateCallbacks,

    async syncStateVector(): Promise<Uint8Array> {
      if (disposed) return new Uint8Array(0);
      return new Uint8Array(addon.coordinator_state_vector(handle));
    },

    async syncDiff(remoteSv: Uint8Array): Promise<Uint8Array> {
      if (disposed) return new Uint8Array(0);
      try {
        const diff = addon.coordinator_pull(handle, participantId, Buffer.from(remoteSv));
        return new Uint8Array(diff);
      } catch {
        return new Uint8Array(0);
      }
    },

    async syncApply(
      update: Uint8Array,
      syncApplyContext?: AdmittedSyncApplyContext,
    ): Promise<unknown> {
      if (disposed || update.length === 0) return;
      if (syncApplyContext) {
        admittedContexts.push(syncApplyContext);
      }
      try {
        const sv = addon.coordinator_state_vector(handle);
        addon.coordinator_push(handle, participantId, Buffer.from(update), [], sv);
        appliedUpdates.push(update);
      } catch {
        // May fail if update is empty or already applied — that's OK
      }
    },

    subscribeUpdateV1(callback: (update: Uint8Array) => void) {
      updateCallbacks.add(callback);
      return {
        unsubscribe: () => {
          updateCallbacks.delete(callback);
        },
      };
    },

    _simulateLocalChange(sourceHandle: number) {
      if (disposed) return;
      // Get full state from the source coordinator
      const joinResult = JSON.parse(addon.coordinator_join(sourceHandle, 'source-temp'));
      const fullState = Buffer.from(joinResult.fullState);
      addon.coordinator_leave(sourceHandle, 'source-temp');

      // Apply it to our coordinator
      const sv = addon.coordinator_state_vector(handle);
      addon.coordinator_push(handle, participantId, fullState, [], sv);

      // Fire update callbacks (simulating subscribeUpdateV1 firing)
      for (const cb of updateCallbacks) {
        cb(new Uint8Array(fullState));
      }
    },

    _dispose() {
      disposed = true;
      try {
        addon.coordinator_dispose(handle);
      } catch {
        /* */
      }
    },
  };

  return bridge;
}

function createBridgeSyncPort(
  bridge: MockBridge,
  roomId: string,
): {
  applyClassifiedRawUpdate(
    update: Uint8Array,
    provenance: ClassifiedRawSyncUpdateProvenance,
  ): Promise<void>;
} {
  return {
    async applyClassifiedRawUpdate(update, provenance) {
      bridge._classifiedProvenance.push(provenance);
      await bridge.syncApply(
        update,
        createAdmittedSyncApplyContext({
          source: 'test-ws-sidecar',
          docId: roomId,
          envelopeVersion: 'classified-raw',
          updateId: provenance.updateIdentity.updateId,
          payloadHash: provenance.updateIdentity.payloadHash,
          provenance,
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeWithAddon('WsSidecar integration (real server)', () => {
  let serverProc: ChildProcess | null = null;
  let wsPort: number;
  let healthPort: number;
  let sidecars: WsSidecar[] = [];
  let bridges: MockBridge[] = [];
  let testLog: CollabTestLog;
  const preseededRooms = new Set<string>();

  beforeAll(async () => {
    testLog = createCollabTestLog();
    wsPort = await getFreePort();
    healthPort = await getFreePort();
    serverProc = await startServer(wsPort, healthPort, testLog);
  }, 30_000);

  afterAll(async () => {
    for (const s of sidecars) {
      try {
        s.detach();
      } catch {
        /* */
      }
    }
    for (const b of bridges) {
      try {
        b._dispose();
      } catch {
        /* */
      }
    }
    if (serverProc) {
      await stopServer(serverProc);
      serverProc = null;
    }
  });

  /** Attach a sidecar with event logging wired in. */
  async function attachWithLog(opts: {
    url: string;
    participantId: string;
    computeBridge: MockBridge;
    syncPort?: {
      applyClassifiedRawUpdate(
        update: Uint8Array,
        provenance: ClassifiedRawSyncUpdateProvenance,
      ): Promise<void>;
    };
  }): Promise<WsSidecar> {
    const roomId = roomIdFromUrl(opts.url);
    if (!preseededRooms.has(roomId)) {
      await preseedBlankRoom(healthPort, roomId);
      preseededRooms.add(roomId);
    }
    const snapshot = await fetchRoomSnapshot(opts.url, roomId);
    const eventLog = createEventLog();
    const sidecar = await attachWsSidecar({
      ...opts,
      preflightStateVector: snapshot.stateVector,
      preflightRoomEpoch: snapshot.roomEpoch,
      preflightFullStateHash: snapshot.fullStateHash,
      preflightSnapshotToken: snapshot.snapshotToken,
      syncPort: opts.syncPort ?? createBridgeSyncPort(opts.computeBridge, roomId),
      eventLog,
    });
    testLog.addSidecar(opts.participantId, eventLog, () => sidecar.status);
    sidecars.push(sidecar);
    return sidecar;
  }

  afterEach(async () => {
    // Dump diagnostics if test failed
    const state = expect.getState();
    if (state.numPassingAsserts === 0 && state.assertionCalls > 0) {
      const diag = testLog.diagnostics();
      console.error('\n=== COLLAB TEST FAILURE DIAGNOSTICS ===');
      console.error(diag.timeline);
      console.error('\n--- Sidecar Stats ---');
      for (const [label, stats] of Object.entries(diag.sidecarStats)) {
        console.error(
          `${label}: sent=${JSON.stringify(stats.sent)} recv=${JSON.stringify(stats.received)}`,
        );
      }
      console.error('=== END DIAGNOSTICS ===\n');
    }

    // Detach sidecars first (stops WS traffic), then wait briefly,
    // then dispose bridges (releases coordinator handles).
    for (const s of sidecars) {
      try {
        s.detach();
      } catch {
        /* */
      }
    }
    sidecars = [];
    await sleep(100);
    for (const b of bridges) {
      try {
        b._dispose();
      } catch {
        /* */
      }
    }
    bridges = [];
    testLog.clear();
  });

  test('two sidecars join the same room and reach online status', async () => {
    const roomId = `test-join-${Date.now()}`;
    const bridgeA = createMockBridge('user-a');
    const bridgeB = createMockBridge('user-b');
    bridges.push(bridgeA, bridgeB);

    const sidecarA = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-a',
      computeBridge: bridgeA,
    });

    const sidecarB = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-b',
      computeBridge: bridgeB,
    });

    expect(sidecarA.status).toBe('online');
    expect(sidecarB.status).toBe('online');
  }, 10_000);

  test('update from client A propagates to client B via server', async () => {
    const roomId = `test-propagate-${Date.now()}`;
    const bridgeA = createMockBridge('user-a');
    const bridgeB = createMockBridge('user-b');
    bridges.push(bridgeA, bridgeB);

    // Connect both sidecars
    const sidecarA = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-a',
      computeBridge: bridgeA,
    });

    const sidecarB = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-b',
      computeBridge: bridgeB,
    });

    // Record B's applied updates
    const bAppliedBefore = bridgeB._appliedUpdates.length;

    // Simulate a local change on A: create a new coordinator with different
    // state, then push that state through A's bridge (which triggers the
    // sidecar's outbound path).
    const sourceCoord = addon.coordinator_create();
    bridgeA._simulateLocalChange(sourceCoord);
    addon.coordinator_dispose(sourceCoord);

    // Wait for the update to propagate: A -> server -> nudge -> B
    // The sidecar debounces at 50ms, and the server processes synchronously.
    // Give it up to 3 seconds.
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      if (bridgeB._appliedUpdates.length > bAppliedBefore) break;
      await sleep(100);
    }

    expect(bridgeB._appliedUpdates.length).toBeGreaterThan(bAppliedBefore);
    expect(bridgeB._classifiedProvenance).toContainEqual(
      expect.objectContaining({
        sourceKind: 'collaborationMixedRemote',
        capturePolicy: 'excluded',
        author: { kind: 'mixedRemote', reason: 'aggregateWithoutBoundaries' },
        replay: false,
        system: false,
        exclusionDiagnostic: expect.objectContaining({
          reason: 'mixedAuthors',
        }),
      }),
    );
    expect(bridgeB._admittedContexts).toContainEqual(
      expect.objectContaining({
        operationContext: expect.objectContaining({
          capturePolicy: 'excluded',
          writeAdmissionMode: 'captureDisabledNoHistory',
          collaboration: expect.objectContaining({
            sourceKind: 'collaborationMixedRemote',
            roomId,
            authorState: 'mixedRemote',
            replay: false,
            system: false,
            commitGrouping: 'excludedLifecycle',
            exclusionReason: 'mixedAuthors',
          }),
        }),
      }),
    );
  }, 10_000);

  test('sidecar transitions to offline on detach', async () => {
    const roomId = `test-detach-${Date.now()}`;
    const bridge = createMockBridge('user-detach');
    bridges.push(bridge);

    const sidecar = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-detach',
      computeBridge: bridge,
    });

    expect(sidecar.status).toBe('online');

    const statusChanges: string[] = [];
    sidecar.onStatusChange((s) => statusChanges.push(s));

    sidecar.detach();

    expect(sidecar.status).toBe('offline');
    expect(statusChanges).toContain('offline');
  }, 10_000);

  test('sidecar status changes are observable', async () => {
    const roomId = `test-status-${Date.now()}`;
    const bridge = createMockBridge('user-status');
    bridges.push(bridge);

    const statusLog: string[] = [];

    const sidecar = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-status',
      computeBridge: bridge,
    });

    // By the time attachWsSidecar resolves, we're already online.
    // Register listener now and test that detach fires.
    const unsub = sidecar.onStatusChange((s) => statusLog.push(s));

    sidecar.detach();

    expect(statusLog).toContain('offline');

    // Unsubscribe should prevent further callbacks
    unsub();
  }, 10_000);

  test('second client receives full state on join', async () => {
    const roomId = `test-full-state-${Date.now()}`;
    const bridgeA = createMockBridge('user-first');
    bridges.push(bridgeA);

    // A joins first
    const sidecarA = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-first',
      computeBridge: bridgeA,
    });

    // Push some state through A so the server has content
    const sourceCoord = addon.coordinator_create();
    bridgeA._simulateLocalChange(sourceCoord);
    addon.coordinator_dispose(sourceCoord);

    // Wait for the push to complete
    await sleep(200);

    // B joins — should receive full state from server
    const bridgeB = createMockBridge('user-second');
    bridges.push(bridgeB);

    const bAppliedBefore = bridgeB._appliedUpdates.length;

    const sidecarB = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-second',
      computeBridge: bridgeB,
    });

    // B should have received the full state during JOIN handshake
    // (classified raw sync admission is called with the JOIN_RESPONSE's full state)
    expect(bridgeB._appliedUpdates.length).toBeGreaterThan(bAppliedBefore);
    expect(bridgeB._classifiedProvenance).toContainEqual(
      expect.objectContaining({
        sourceKind: 'collaborationHydration',
        capturePolicy: 'excluded',
        replay: true,
        system: true,
        author: { kind: 'system', systemRef: 'collaboration-hydration' },
        updateIdentity: expect.objectContaining({
          originKind: 'room',
          roomId,
        }),
      }),
    );
    expect(bridgeB._admittedContexts).toContainEqual(
      expect.objectContaining({
        operationContext: expect.objectContaining({
          capturePolicy: 'excluded',
          writeAdmissionMode: 'captureDisabledNoHistory',
          collaboration: expect.objectContaining({
            sourceKind: 'collaborationHydration',
            roomId,
            authorState: 'system',
            replay: true,
            system: true,
            commitGrouping: 'excludedLifecycle',
            exclusionReason: 'hydration',
          }),
        }),
      }),
    );
  }, 10_000);

  test('bidirectional: both clients send and both receive', async () => {
    const roomId = `test-bidi-${Date.now()}`;
    const bridgeA = createMockBridge('user-a');
    const bridgeB = createMockBridge('user-b');
    bridges.push(bridgeA, bridgeB);

    const sidecarA = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-a',
      computeBridge: bridgeA,
    });

    const sidecarB = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-b',
      computeBridge: bridgeB,
    });

    const aAppliedBefore = bridgeA._appliedUpdates.length;
    const bAppliedBefore = bridgeB._appliedUpdates.length;

    // A sends
    const srcA = addon.coordinator_create();
    bridgeA._simulateLocalChange(srcA);
    addon.coordinator_dispose(srcA);

    // Wait for propagation
    await sleep(300);

    // B sends
    const srcB = addon.coordinator_create();
    bridgeB._simulateLocalChange(srcB);
    addon.coordinator_dispose(srcB);

    // Wait for both to receive
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      if (
        bridgeA._appliedUpdates.length > aAppliedBefore &&
        bridgeB._appliedUpdates.length > bAppliedBefore
      )
        break;
      await sleep(100);
    }

    expect(bridgeB._appliedUpdates.length).toBeGreaterThan(bAppliedBefore);
    expect(bridgeA._appliedUpdates.length).toBeGreaterThan(aAppliedBefore);
  }, 10_000);

  test('three peers: edits from one propagate to both others', async () => {
    const roomId = `test-three-${Date.now()}`;
    const bridgeA = createMockBridge('user-a');
    const bridgeB = createMockBridge('user-b');
    const bridgeC = createMockBridge('user-c');
    bridges.push(bridgeA, bridgeB, bridgeC);

    const sidecarA = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-a',
      computeBridge: bridgeA,
    });

    const sidecarB = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-b',
      computeBridge: bridgeB,
    });

    const sidecarC = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-c',
      computeBridge: bridgeC,
    });

    const bBefore = bridgeB._appliedUpdates.length;
    const cBefore = bridgeC._appliedUpdates.length;

    // A sends a change
    const src = addon.coordinator_create();
    bridgeA._simulateLocalChange(src);
    addon.coordinator_dispose(src);

    // Wait for propagation to B and C
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      if (bridgeB._appliedUpdates.length > bBefore && bridgeC._appliedUpdates.length > cBefore)
        break;
      await sleep(100);
    }

    expect(bridgeB._appliedUpdates.length).toBeGreaterThan(bBefore);
    expect(bridgeC._appliedUpdates.length).toBeGreaterThan(cBefore);
  }, 10_000);

  test('graceful peer disconnect does not crash remaining peers', async () => {
    const roomId = `test-disconnect-${Date.now()}`;
    const bridgeA = createMockBridge('user-a');
    const bridgeB = createMockBridge('user-b');
    bridges.push(bridgeA, bridgeB);

    const sidecarA = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-a',
      computeBridge: bridgeA,
    });

    const sidecarB = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-b',
      computeBridge: bridgeB,
    });

    // A disconnects
    sidecarA.detach();
    await sleep(200);

    // B should still be online
    expect(sidecarB.status).toBe('online');
  }, 10_000);

  test('connection to invalid URL rejects', async () => {
    const bridge = createMockBridge('user-fail');
    bridges.push(bridge);

    await expect(
      attachWsSidecar({
        url: 'ws://localhost:1/unreachable-room', // nothing listening
        participantId: 'user-fail',
        computeBridge: bridge,
        syncPort: createBridgeSyncPort(bridge, 'unreachable-room'),
      }),
    ).rejects.toThrow();
  }, 10_000);

  // ── Awareness / Presence E2E ──

  test('awareness: setPresence on A is received by B via onPresenceChange', async () => {
    const roomId = `test-awareness-${Date.now()}`;
    const bridgeA = createMockBridge('user-a');
    const bridgeB = createMockBridge('user-b');
    bridges.push(bridgeA, bridgeB);

    const sidecarA = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-a',
      computeBridge: bridgeA,
    });
    const sidecarB = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-b',
      computeBridge: bridgeB,
    });

    // Wait for both to be online
    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline &&
      (sidecarA.status !== 'online' || sidecarB.status !== 'online')
    ) {
      await sleep(50);
    }
    expect(sidecarA.status).toBe('online');
    expect(sidecarB.status).toBe('online');

    // B subscribes to presence changes
    const receivedByB: Array<ReadonlyMap<string, any>> = [];
    sidecarB.onPresenceChange((p) => {
      receivedByB.push(new Map(p));
    });

    // A sets presence
    sidecarA.setPresence({
      displayName: 'Alice',
      color: '#ff0000',
      selection: { sheetId: 'sheet1', row: 0, col: 0 },
    });

    // Wait for B to receive the update (debounce 100ms + network)
    const presenceDeadline = Date.now() + 5_000;
    while (Date.now() < presenceDeadline && receivedByB.length === 0) {
      await sleep(50);
    }

    expect(receivedByB.length).toBeGreaterThan(0);
    const latest = receivedByB[receivedByB.length - 1];
    expect(latest.has('user-a')).toBe(true);
    const alicePresence = latest.get('user-a');
    expect(alicePresence.displayName).toBe('Alice');
    expect(alicePresence.color).toBe('#ff0000');
    expect(alicePresence.selection).toEqual({ sheetId: 'sheet1', row: 0, col: 0 });
  }, 10_000);

  test('awareness: disconnect removes participant from presence', async () => {
    const roomId = `test-awareness-dc-${Date.now()}`;
    const bridgeA = createMockBridge('user-a');
    const bridgeB = createMockBridge('user-b');
    bridges.push(bridgeA, bridgeB);

    const sidecarA = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-a',
      computeBridge: bridgeA,
    });
    const sidecarB = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-b',
      computeBridge: bridgeB,
    });

    // Wait for online
    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline &&
      (sidecarA.status !== 'online' || sidecarB.status !== 'online')
    ) {
      await sleep(50);
    }

    // A sets presence, wait for B to receive it
    sidecarA.setPresence({ displayName: 'Alice', color: '#ff0000' });
    const presenceDeadline = Date.now() + 5_000;
    while (Date.now() < presenceDeadline && !sidecarB.participants.has('user-a')) {
      await sleep(50);
    }
    expect(sidecarB.participants.has('user-a')).toBe(true);

    // Track removal events
    const removals: Array<ReadonlyMap<string, any>> = [];
    sidecarB.onPresenceChange((p) => {
      if (!p.has('user-a')) {
        removals.push(new Map(p));
      }
    });

    // A disconnects
    sidecarA.detach();
    // Remove from sidecars array since we manually detached
    sidecars = sidecars.filter((s) => s !== sidecarA);

    // Wait for B to see the removal
    const removalDeadline = Date.now() + 5_000;
    while (Date.now() < removalDeadline && sidecarB.participants.has('user-a')) {
      await sleep(50);
    }
    expect(sidecarB.participants.has('user-a')).toBe(false);
  }, 10_000);

  test("awareness: three peers see each other's presence", async () => {
    const roomId = `test-awareness-3p-${Date.now()}`;
    const bridgeA = createMockBridge('user-a');
    const bridgeB = createMockBridge('user-b');
    const bridgeC = createMockBridge('user-c');
    bridges.push(bridgeA, bridgeB, bridgeC);

    const sidecarA = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-a',
      computeBridge: bridgeA,
    });
    const sidecarB = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-b',
      computeBridge: bridgeB,
    });
    const sidecarC = await attachWithLog({
      url: `ws://localhost:${wsPort}/${roomId}`,
      participantId: 'user-c',
      computeBridge: bridgeC,
    });

    // Wait for all online
    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline &&
      (sidecarA.status !== 'online' || sidecarB.status !== 'online' || sidecarC.status !== 'online')
    ) {
      await sleep(50);
    }

    // All set presence
    sidecarA.setPresence({ displayName: 'Alice', color: '#ff0000' });
    sidecarB.setPresence({ displayName: 'Bob', color: '#00ff00' });
    sidecarC.setPresence({ displayName: 'Charlie', color: '#0000ff' });

    // Wait for A to see both B and C
    const convergenceDeadline = Date.now() + 5_000;
    while (
      Date.now() < convergenceDeadline &&
      (sidecarA.participants.size < 2 ||
        sidecarB.participants.size < 2 ||
        sidecarC.participants.size < 2)
    ) {
      await sleep(50);
    }

    // Each peer should see the other two
    expect(sidecarA.participants.has('user-b')).toBe(true);
    expect(sidecarA.participants.has('user-c')).toBe(true);
    expect(sidecarB.participants.has('user-a')).toBe(true);
    expect(sidecarB.participants.has('user-c')).toBe(true);
    expect(sidecarC.participants.has('user-a')).toBe(true);
    expect(sidecarC.participants.has('user-b')).toBe(true);

    expect(sidecarA.participants.get('user-b')?.displayName).toBe('Bob');
    expect(sidecarC.participants.get('user-a')?.displayName).toBe('Alice');
  }, 10_000);
});
