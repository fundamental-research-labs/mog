/**
 * Debug Recorder — unit tests.
 *
 * Validates the start/stop/export lifecycle, console log capture,
 * state transition capture, state snapshots, and JSON serialization.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { createConsoleAPI } from '../src/console/api';
import { EventStore } from '../src/event-store';
import { ActorRecorder } from '../src/recorders/actor-recorder';
import { DebugRecorder } from '../src/recorders/debug-recorder';
import type { DevToolsConsoleAPI } from '../src/types';

// ── Minimal window polyfill for bun ──

function setupRuntime(): {
  store: EventStore;
  actorRecorder: ActorRecorder;
  api: DevToolsConsoleAPI;
  cleanup: () => void;
} {
  const g = globalThis as { window?: Record<string, unknown> };
  g.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { href: 'http://test' },
    navigator: { userAgent: 'test-agent' },
  };

  const store = new EventStore();
  store.enable();
  const actorRecorder = new ActorRecorder(store);
  const api = createConsoleAPI(store, actorRecorder);

  return {
    store,
    actorRecorder,
    api,
    cleanup: () => {
      delete g.window;
    },
  };
}

describe('DebugRecorder', () => {
  let store: EventStore;
  let actorRecorder: ActorRecorder;
  let api: DevToolsConsoleAPI;
  let recorder: DebugRecorder;
  let cleanup: () => void;

  beforeEach(() => {
    ({ store, actorRecorder, api, cleanup } = setupRuntime());
    recorder = new DebugRecorder(store, actorRecorder, api);
  });

  afterEach(() => {
    // Ensure recording is stopped (restores console)
    if (recorder.isRecording) recorder.discard();
    cleanup();
  });

  test('isRecording reflects start/stop state', () => {
    expect(recorder.isRecording).toBe(false);
    recorder.start();
    expect(recorder.isRecording).toBe(true);
    recorder.stop();
    expect(recorder.isRecording).toBe(false);
  });

  test('start is idempotent', () => {
    recorder.start();
    recorder.start(); // should not throw
    expect(recorder.isRecording).toBe(true);
    recorder.stop();
  });

  test('stop without start returns null', () => {
    expect(recorder.stop()).toBeNull();
  });

  test('stop returns a bundle with correct structure', () => {
    recorder.start();

    // Push some events into the store
    store.push({
      type: 'action',
      timestamp: Date.now(),
      action: 'TEST_ACTION',
      durationMs: 5,
      handled: true,
      receiptCount: 0,
    });

    const bundle = recorder.stop() as any;
    expect(bundle).not.toBeNull();
    expect(bundle.version).toBe(1);

    // Metadata
    expect(bundle.metadata.recordedAt).toBeTruthy();
    expect(bundle.metadata.stoppedAt).toBeTruthy();
    expect(typeof bundle.metadata.durationMs).toBe('number');

    // State snapshots
    expect(bundle.stateSnapshots.start).toBeTruthy();
    expect(bundle.stateSnapshots.end).toBeTruthy();
    expect(bundle.stateSnapshots.start.state).toBeTruthy();
    expect(bundle.stateSnapshots.end.state).toBeTruthy();

    // Devtools
    expect(Array.isArray(bundle.devtools.events)).toBe(true);
    expect(bundle.devtools.events.length).toBeGreaterThan(0);
    expect(typeof bundle.devtools.machines).toBe('object');
    expect(Array.isArray(bundle.devtools.logs)).toBe(true);
    expect(Array.isArray(bundle.devtools.errors)).toBe(true);
    expect(Array.isArray(bundle.devtools.stateTransitions)).toBe(true);
  });

  test('captures console logs during recording', () => {
    recorder.start();

    // These should be captured
    console.log('test log message');
    console.warn('test warning');
    console.info('test info');

    const bundle = recorder.stop() as any;
    const logs = bundle.devtools.logs;

    expect(logs.length).toBe(3);
    expect(logs[0].level).toBe('log');
    expect(logs[0].args).toContain('test log message');
    expect(logs[1].level).toBe('warn');
    expect(logs[2].level).toBe('info');
  });

  test('does not capture console logs after stop', () => {
    recorder.start();
    console.log('during recording');
    recorder.stop();

    // This should NOT be captured
    console.log('after recording');

    // Start a new recording to verify clean state
    recorder.start();
    const bundle = recorder.stop() as any;
    expect(bundle.devtools.logs.length).toBe(0);
  });

  test('captures state transitions during recording', () => {
    recorder.start();

    // Simulate an XState snapshot transition
    actorRecorder.record('test-machine', {
      type: '@xstate.snapshot',
      snapshot: { value: 'idle', context: {} },
    });
    actorRecorder.record('test-machine', {
      type: '@xstate.snapshot',
      snapshot: { value: 'active', context: {} },
      event: { type: 'ACTIVATE' },
    });

    const bundle = recorder.stop() as any;
    const transitions = bundle.devtools.stateTransitions;

    // The first snapshot sets state to 'idle' from '(unknown)' which is a transition
    // The second snapshot transitions from 'idle' to 'active'
    expect(transitions.length).toBeGreaterThanOrEqual(1);

    const lastTransition = transitions[transitions.length - 1];
    expect(lastTransition.actorId).toBe('test-machine');
    expect(lastTransition.fromState).toBe('idle');
    expect(lastTransition.toState).toBe('active');
  });

  test('discard stops recording without producing a bundle', () => {
    recorder.start();
    expect(recorder.isRecording).toBe(true);

    recorder.discard();
    expect(recorder.isRecording).toBe(false);
  });

  test('subscribe notifies listeners on start/stop', () => {
    let callCount = 0;
    const unsub = recorder.subscribe(() => callCount++);

    recorder.start();
    expect(callCount).toBe(1);

    recorder.stop();
    expect(callCount).toBe(2);

    unsub();
    recorder.start();
    expect(callCount).toBe(2); // no notification after unsub
    recorder.discard();
  });

  test('bundle is JSON-serializable', () => {
    recorder.start();
    store.push({
      type: 'bridge',
      timestamp: Date.now(),
      bridgeName: 'compute',
      method: 'queryRange',
      durationMs: 10,
    });
    console.log('serialization test');
    const bundle = recorder.stop();

    // Should not throw
    const json = JSON.stringify(bundle);
    expect(typeof json).toBe('string');

    // Should round-trip
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.devtools.logs.length).toBe(1);
  });

  test('serializes viewport buffers from the live bridge accessor', () => {
    let currentCell = { row: 0, col: 0 };
    const buffer = {
      hasBuffer: () => true,
      getStartRow: () => 0,
      getStartCol: () => 0,
      getRows: () => 5,
      getCols: () => 5,
      getCellCount: () => 25,
      getGeneration: () => 7,
    };
    const accessor = {
      moveTo: (row: number, col: number) => {
        currentCell = { row, col };
        return row >= 0 && row < 5 && col >= 0 && col < 5;
      },
      get displayText() {
        return `R${currentCell.row}C${currentCell.col}`;
      },
      get valueType() {
        return 1;
      },
      get format() {
        return {
          fontWeight: 'bold',
          row: currentCell.row,
          col: currentCell.col,
        };
      },
      getBgColorOverride: () => null,
      getFontColorOverride: () => null,
    };
    const bridge = {
      getPerViewportStates: () => new Map([['main:sheet-1', { lastVisibleBounds: {} }]]),
      getViewportBuffer: (viewportId: string) =>
        viewportId === 'main:sheet-1' ? buffer : undefined,
      getAccessorForViewport: () => accessor,
    };
    const win = (globalThis as any).window;
    win.__SHELL__ = {
      store: { getState: () => ({ activeFileId: 'file-1' }) },
      documentManager: {
        getDocument: () => ({ context: { computeBridge: bridge } }),
      },
    };
    win.__COORDINATOR__ = {
      grid: {
        access: {
          accessors: {
            selection: { getActiveCell: () => ({ row: 2, col: 2 }) },
          },
        },
      },
    };

    const json = api.toJSON() as any;
    const viewport = json.viewportBuffers['main:sheet-1'];

    expect(viewport.bounds).toEqual({ startRow: 0, startCol: 0, rows: 5, cols: 5 });
    expect(viewport.cellCount).toBe(25);
    expect(viewport.generation).toBe(7);
    expect(viewport.sampleCells.length).toBe(25);
    expect(viewport.sampleCells[12]).toEqual({
      row: 2,
      col: 2,
      displayText: 'R2C2',
      valueType: 1,
      format: { fontWeight: 'bold', row: 2, col: 2 },
    });
    expect(viewport.sampleCells.every((cell: any) => cell.format?.fontWeight === 'bold')).toBe(
      true,
    );
  });

  test('events are scoped to the recording window (pre-recording events excluded)', () => {
    // Push events BEFORE recording starts
    store.push({
      type: 'action',
      timestamp: Date.now(),
      action: 'PRE_RECORD_ACTION',
      durationMs: 1,
      handled: true,
      receiptCount: 0,
    });

    recorder.start();

    // Push events DURING recording
    store.push({
      type: 'action',
      timestamp: Date.now(),
      action: 'DURING_RECORD_ACTION',
      durationMs: 2,
      handled: true,
      receiptCount: 0,
    });

    const bundle = recorder.stop() as any;
    const events = bundle.devtools.events;

    // Should only contain the during-recording event, not the pre-recording one
    const actionNames = events.map((e: any) => e.event.action).filter(Boolean);
    expect(actionNames).toContain('DURING_RECORD_ACTION');
    expect(actionNames).not.toContain('PRE_RECORD_ACTION');
  });

  test('diagnostics.duplicateEventCount is present', () => {
    recorder.start();

    store.push({
      type: 'action',
      timestamp: Date.now(),
      action: 'SOME_ACTION',
      durationMs: 1,
      handled: true,
      receiptCount: 0,
    });

    const bundle = recorder.stop() as any;
    expect(bundle.diagnostics).toBeTruthy();
    expect(typeof bundle.diagnostics.duplicateEventCount).toBe('number');
  });

  test('cellFormats is present in state snapshots', () => {
    recorder.start();
    const bundle = recorder.stop() as any;

    expect(bundle.stateSnapshots.start.state.cellFormats).toBeDefined();
    expect(typeof bundle.stateSnapshots.start.state.cellFormats).toBe('object');
    expect(bundle.stateSnapshots.end.state.cellFormats).toBeDefined();
    expect(typeof bundle.stateSnapshots.end.state.cellFormats).toBe('object');
  });

  test('state snapshots contain machine states', () => {
    // Set up a machine state before recording starts
    actorRecorder.record('selection', {
      type: '@xstate.snapshot',
      snapshot: { value: 'idle', context: { ranges: [] } },
    });

    recorder.start();
    const bundle = recorder.stop() as any;

    // Start snapshot should have captured machine states
    const startMachines = bundle.stateSnapshots.start.state.machines;
    expect(startMachines).toBeTruthy();
    expect(startMachines.selection).toBeTruthy();
    expect(startMachines.selection.state).toBe('idle');
  });
});
