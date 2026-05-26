/**
 * ViewportCoordinator + ViewportCoordinatorRegistry tests.
 *
 * Covers:
 *   A. Basic state management (tests 1-6)
 *   B. Mutation patch path (tests 7-11)
 *   C. Fetch-commit path (tests 12-24)
 *   D. Dimension patch path (tests 25-27)
 *   E. Subscriber notification ordering (tests 28-31)
 *   F. Registry tests (tests 32-39)
 */

// Polyfill window for Node test environment (devtools reporting uses `window`)
import { jest } from '@jest/globals';

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {};
}

import { ViewportCoordinator, cellKey, ViewportChangeEvent } from '../viewport-coordinator';
import { ViewportCoordinatorRegistry } from '../viewport-coordinator-registry';
import {
  BinaryViewportBuffer,
  CellAccessor,
  VALUE_TYPE_NUMBER,
  VALUE_TYPE_ERROR,
} from '../binary-viewport-buffer';
import { BinaryMutationReader } from '../binary-mutation-reader';
import { buildTestViewportBuffer } from '../viewport-test-builder';
import { buildTestMutationBuffer, buildPackedMultiViewportPatches } from '../mutation-test-builder';
import { displayStringOrNull } from '@mog-sdk/contracts/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a ViewportCoordinator with an initial buffer loaded.
 * Returns the coordinator and a CellAccessor for verification.
 */
function createReadyCoordinator(
  viewportId: string,
  viewportOpts: Parameters<typeof buildTestViewportBuffer>[0],
): { coordinator: ViewportCoordinator; accessor: CellAccessor } {
  const coordinator = new ViewportCoordinator(viewportId);
  const buffer = buildTestViewportBuffer(viewportOpts);
  coordinator.commitFetch(buffer, 0);
  const accessor = coordinator.base.createAccessor();
  return { coordinator, accessor };
}

/**
 * Build and apply a test mutation to a coordinator.
 */
function applyTestMutation(
  coordinator: ViewportCoordinator,
  patches: Array<{
    row: number;
    col: number;
    numberValue?: number;
    display?: string;
    error?: string;
    flags?: number;
    formatIdx?: number;
  }>,
): void {
  const buf = buildTestMutationBuffer({ patches });
  const reader = new BinaryMutationReader(buf);
  coordinator.applyMutationPatches(reader);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ViewportCoordinator', () => {
  // =========================================================================
  // A. Basic State Management (tests 1-6)
  // =========================================================================

  describe('basic state management', () => {
    it('creates with empty state', () => {
      const coordinator = new ViewportCoordinator('main');

      expect(coordinator.getBounds()).toBeNull();
      expect(coordinator.version).toBe(0);
      expect(coordinator.disposed).toBe(false);
      expect(coordinator.getMerges()).toEqual([]);
    });

    it('commitFetch sets base buffer and emits fetch-committed', () => {
      const coordinator = new ViewportCoordinator('main');
      const events: ViewportChangeEvent[] = [];
      coordinator.subscribe((e) => events.push(e));

      const epoch = coordinator.startFetch();
      const buffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 42, display: '42', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(buffer, epoch);

      // Bounds are set
      const bounds = coordinator.getBounds();
      expect(bounds).not.toBeNull();
      expect(bounds!.startRow).toBe(0);
      expect(bounds!.startCol).toBe(0);
      expect(bounds!.endRow).toBe(2);
      expect(bounds!.endCol).toBe(2);

      // Subscriber received exactly one fetch-committed event
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('fetch-committed');

      // CellAccessor reads correct data
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(42);
    });

    it('version increments on every write operation', () => {
      const coordinator = new ViewportCoordinator('main');

      // V1: first commitFetch
      const buf1 = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
        rowDimensions: [{ row: 0, height: 20 }],
      });
      coordinator.commitFetch(buf1, 0);
      const v1 = coordinator.version;

      // V2: applyMutationPatches
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER },
      ]);
      const v2 = coordinator.version;

      // V3: applyDimensionPatch
      coordinator.applyDimensionPatch('row', 0, 40, false);
      const v3 = coordinator.version;

      // V4: second commitFetch
      const buf2 = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 2, display: '2', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(buf2, 0);
      const v4 = coordinator.version;

      // Strictly monotonically increasing
      expect(v1).toBe(1);
      expect(v2).toBe(2);
      expect(v3).toBe(3);
      expect(v4).toBe(4);
      expect(v1).toBeLessThan(v2);
      expect(v2).toBeLessThan(v3);
      expect(v3).toBeLessThan(v4);
    });

    it('dispose clears state and prevents further operations', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 42, display: '42', flags: VALUE_TYPE_NUMBER }],
      });

      const events: ViewportChangeEvent[] = [];
      coordinator.subscribe((e) => events.push(e));

      coordinator.dispose();

      expect(coordinator.disposed).toBe(true);

      // Mutations after dispose should not invoke subscriber
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER },
      ]);
      expect(events).toHaveLength(0);

      // commitFetch after dispose should not invoke subscriber
      const buf = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
      });
      coordinator.commitFetch(buf, 0);
      expect(events).toHaveLength(0);
    });

    it('subscribe returns working unsubscribe function', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });

      let callCount = 0;
      const unsub = coordinator.subscribe(() => {
        callCount++;
      });

      // First mutation: callback invoked
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER },
      ]);
      expect(callCount).toBe(1);

      // Unsubscribe
      unsub();

      // Second mutation: callback NOT invoked
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 20, display: '20', flags: VALUE_TYPE_NUMBER },
      ]);
      expect(callCount).toBe(1);
    });

    it('multiple subscribers all receive events', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });

      const events1: ViewportChangeEvent[] = [];
      const events2: ViewportChangeEvent[] = [];
      coordinator.subscribe((e) => events1.push(e));
      coordinator.subscribe((e) => events2.push(e));

      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER },
      ]);

      expect(events1).toHaveLength(1);
      expect(events1[0].type).toBe('cells-patched');
      expect(events2).toHaveLength(1);
      expect(events2[0].type).toBe('cells-patched');
    });
  });

  // =========================================================================
  // B. Mutation Patch Path (tests 7-11)
  // =========================================================================

  describe('mutation patch path', () => {
    it('applyMutationPatches updates base buffer and emits cells-patched', () => {
      const { coordinator, accessor } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 42, display: '42', flags: VALUE_TYPE_NUMBER }],
      });

      const events: ViewportChangeEvent[] = [];
      coordinator.subscribe((e) => events.push(e));

      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER },
      ]);

      // CellAccessor reads updated value
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(100);
      expect(displayStringOrNull(accessor.displayText)).toBe('100');

      // Subscriber received cells-patched event with correct coordinates
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('cells-patched');
      const cellsEvent = events[0] as {
        type: 'cells-patched';
        cells: { row: number; col: number }[];
      };
      expect(cellsEvent.cells).toEqual([{ row: 0, col: 0 }]);
    });

    it('applyMutationPatches stores overlay entries for re-application after fetch', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 42, display: '42', flags: VALUE_TYPE_NUMBER }],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start a fetch (captures current version as epoch)
      const epoch = coordinator.startFetch();

      // Apply mutation AFTER startFetch — overlay entry epoch > fetchEpoch
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER },
      ]);

      // Commit fetch with ORIGINAL buffer (doesn't contain mutation)
      const originalBuffer = buildTestViewportBuffer(viewportOpts);
      coordinator.commitFetch(originalBuffer, epoch);

      // Overlay should have re-applied: accessor reads mutated value
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(100);
      expect(displayStringOrNull(accessor.displayText)).toBe('100');
    });

    it('out-of-viewport patches are skipped in overlay', () => {
      const { coordinator, accessor } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 42, display: '42', flags: VALUE_TYPE_NUMBER }],
      });

      const events: ViewportChangeEvent[] = [];
      coordinator.subscribe((e) => events.push(e));

      // Mutation targeting (100, 100) — far outside 3x3 viewport
      applyTestMutation(coordinator, [
        { row: 100, col: 100, numberValue: 999, display: '999', flags: VALUE_TYPE_NUMBER },
      ]);

      // No cells-patched event emitted (dirtyCells is empty)
      expect(events).toHaveLength(0);

      // Original data preserved
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(42);
    });

    it('multiple sequential mutations accumulate in overlay', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch
      const epoch = coordinator.startFetch();

      // M1: set (0,0)=100
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER },
      ]);

      // M2: set (0,1)=200
      applyTestMutation(coordinator, [
        { row: 0, col: 1, numberValue: 200, display: '200', flags: VALUE_TYPE_NUMBER },
      ]);

      // Commit fetch with original buffer (all empty cells)
      const originalBuffer = buildTestViewportBuffer(viewportOpts);
      coordinator.commitFetch(originalBuffer, epoch);

      // Both overlay entries should be re-applied
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(100);
      expect(displayStringOrNull(accessor.displayText)).toBe('100');

      accessor.moveTo(0, 1);
      expect(accessor.numberValue).toBe(200);
      expect(displayStringOrNull(accessor.displayText)).toBe('200');
    });

    it('mutation to same cell overwrites previous overlay entry', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch
      const epoch = coordinator.startFetch();

      // First mutation: (0,0)=100
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER },
      ]);

      // Second mutation: (0,0)=200 (overwrites)
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 200, display: '200', flags: VALUE_TYPE_NUMBER },
      ]);

      // Commit fetch with original buffer
      const originalBuffer = buildTestViewportBuffer(viewportOpts);
      coordinator.commitFetch(originalBuffer, epoch);

      // Latest overlay value wins
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(200);
      expect(displayStringOrNull(accessor.displayText)).toBe('200');
    });

    it('applyMutationPatches with zero patches is a no-op', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 42, display: '42', flags: VALUE_TYPE_NUMBER }],
      };

      const { coordinator, accessor } = createReadyCoordinator('main', viewportOpts);
      const versionBefore = coordinator.version;

      const events: ViewportChangeEvent[] = [];
      coordinator.subscribe((e) => events.push(e));

      // Apply mutation with empty patches array
      const buf = buildTestMutationBuffer({ patches: [] });
      const reader = new BinaryMutationReader(buf);
      coordinator.applyMutationPatches(reader);

      // No events emitted (no dirty cells)
      expect(events).toHaveLength(0);

      // Version must NOT increment when there are no in-viewport dirty cells
      expect(coordinator.version).toBe(versionBefore);

      // Original data intact
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(42);
      expect(displayStringOrNull(accessor.displayText)).toBe('42');
    });

    it('spill patches are stored in overlay and re-applied after fetch-commit', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [
          { numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER },
          { numberValue: 2, display: '2', flags: VALUE_TYPE_NUMBER },
          { numberValue: 3, display: '3', flags: VALUE_TYPE_NUMBER },
        ],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch
      const epoch = coordinator.startFetch();

      // Apply mutation with spill patches (array formula result spilling to adjacent cells)
      const buf = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER }],
        spillPatches: [
          { row: 0, col: 1, numberValue: 20, display: '20', flags: VALUE_TYPE_NUMBER },
          { row: 0, col: 2, numberValue: 30, display: '30', flags: VALUE_TYPE_NUMBER },
        ],
      });
      const reader = new BinaryMutationReader(buf);
      coordinator.applyMutationPatches(reader);

      // Commit fetch with ORIGINAL buffer (doesn't contain mutation or spills)
      const originalBuffer = buildTestViewportBuffer(viewportOpts);
      coordinator.commitFetch(originalBuffer, epoch);

      // Verify all cells — both regular patch and spill patches — are re-applied
      const accessor = coordinator.base.createAccessor();

      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(10);
      expect(displayStringOrNull(accessor.displayText)).toBe('10');

      accessor.moveTo(0, 1);
      expect(accessor.numberValue).toBe(20);
      expect(displayStringOrNull(accessor.displayText)).toBe('20');

      accessor.moveTo(0, 2);
      expect(accessor.numberValue).toBe(30);
      expect(displayStringOrNull(accessor.displayText)).toBe('30');
    });
  });

  // =========================================================================
  // C. Fetch-Commit Path (tests 12-17)
  // =========================================================================

  describe('fetch-commit path', () => {
    it('commitFetch with no overlay entries just swaps buffer', () => {
      const coordinator = new ViewportCoordinator('main');

      const buffer = buildTestViewportBuffer({
        rows: 2,
        cols: 2,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 99, display: '99', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(buffer, 0);

      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(99);

      const bounds = coordinator.getBounds();
      expect(bounds).not.toBeNull();
      expect(bounds!.startRow).toBe(0);
      expect(bounds!.startCol).toBe(0);
      expect(bounds!.endRow).toBe(1);
      expect(bounds!.endCol).toBe(1);
    });

    it('commitFetch retains overlay entries newer than fetchEpoch', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER }],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch — epoch captures current version
      const epoch = coordinator.startFetch();

      // Mutation AFTER startFetch: overlay entry epoch > fetchEpoch
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 99, display: '99', flags: VALUE_TYPE_NUMBER },
      ]);

      // Commit with buffer B (same as A — Rust hasn't seen the mutation)
      const bufferB = buildTestViewportBuffer(viewportOpts);
      coordinator.commitFetch(bufferB, epoch);

      // Overlay retained and re-applied
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(99);
      expect(displayStringOrNull(accessor.displayText)).toBe('99');
    });

    it('commitFetch discards overlay entries older than fetchEpoch', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER }],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Mutation BEFORE startFetch
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 99, display: '99', flags: VALUE_TYPE_NUMBER },
      ]);

      // Now start fetch — epoch includes the mutation
      const epoch = coordinator.startFetch();

      // Commit with buffer B that has Rust's computed value (50)
      const bufferB = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 50, display: '50', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(bufferB, epoch);

      // Overlay discarded — fetch data wins
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(50);
      expect(displayStringOrNull(accessor.displayText)).toBe('50');
    });

    it('interleaved mutations and fetches maintain consistency', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [
          { numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER },
          { numberValue: 2, display: '2', flags: VALUE_TYPE_NUMBER },
        ],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // M1: set (0,0)=10
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER },
      ]);

      // Start fetch — epoch includes M1
      const epoch = coordinator.startFetch();

      // M2: set (0,1)=20 — AFTER startFetch, so epoch(M2) > fetchEpoch
      applyTestMutation(coordinator, [
        { row: 0, col: 1, numberValue: 20, display: '20', flags: VALUE_TYPE_NUMBER },
      ]);

      // Buffer B: Rust saw M1 but not M2
      const bufferB = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [
          { numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER },
          { numberValue: 2, display: '2', flags: VALUE_TYPE_NUMBER },
        ],
      });
      coordinator.commitFetch(bufferB, epoch);

      const accessor = coordinator.base.createAccessor();

      // (0,0)=10: from fetch (M1's overlay discarded, epoch(M1) <= fetchEpoch)
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(10);

      // (0,1)=20: M2's overlay retained and re-applied (epoch(M2) > fetchEpoch)
      accessor.moveTo(0, 1);
      expect(accessor.numberValue).toBe(20);
      expect(displayStringOrNull(accessor.displayText)).toBe('20');
    });

    it('stale fetch is rejected — fresh data is preserved', () => {
      const viewportOptsA = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOptsA);

      // Two startFetch calls — epoch1 < epoch2 (both equal since no mutations between)
      const epoch1 = coordinator.startFetch();

      // Apply a mutation to advance the version, then start a second fetch
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 50, display: '50', flags: VALUE_TYPE_NUMBER },
      ]);
      const epoch2 = coordinator.startFetch();
      expect(epoch2).toBeGreaterThan(epoch1);

      // Commit the second (latest) fetch first — this is the "fresh" response
      const bufferB2 = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 222, display: '222', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(bufferB2, epoch2);

      // Verify data from buffer B2
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(222);

      const versionAfterFresh = coordinator.version;

      // Now the stale fetch (epoch1) arrives late — coordinator must reject it
      const events: ViewportChangeEvent[] = [];
      coordinator.subscribe((e) => events.push(e));

      const bufferB1 = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 111, display: '111', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(bufferB1, epoch1);

      // Stale commit is silently rejected: data still reflects fresh bufferB2
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(222);

      // No event emitted for rejected commit
      expect(events).toHaveLength(0);

      // Version did not advance
      expect(coordinator.version).toBe(versionAfterFresh);
    });

    it('commitFetch re-applies overlay strings to overflow pool', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 0, display: 'original', flags: VALUE_TYPE_NUMBER }],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch
      const epoch = coordinator.startFetch();

      // Mutation with new display string
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 0, display: 'hello-world', flags: VALUE_TYPE_NUMBER },
      ]);

      // Commit with original buffer (has 'original')
      const bufferB = buildTestViewportBuffer(viewportOpts);
      coordinator.commitFetch(bufferB, epoch);

      // Overlay string re-applied via writeOverlayEntryToBase
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(displayStringOrNull(accessor.displayText)).toBe('hello-world');
    });

    it('commitFetch re-applies overlay error strings to overflow pool', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 0, display: '0', flags: VALUE_TYPE_NUMBER }],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch
      const epoch = coordinator.startFetch();

      // Mutation with an error string (VALUE_TYPE_ERROR flag)
      applyTestMutation(coordinator, [
        { row: 0, col: 0, error: '#VALUE!', flags: VALUE_TYPE_ERROR },
      ]);

      // Commit with original buffer (has no error)
      const bufferB = buildTestViewportBuffer(viewportOpts);
      coordinator.commitFetch(bufferB, epoch);

      // Error string should be re-applied via overlay
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.errorText).toBe('#VALUE!');
    });

    it('commitDelta re-applies overlay entries after delta merge', () => {
      // Start with a 3x3 viewport at (0,0)
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });

      // Start a fetch (simulating a scroll)
      const epoch = coordinator.startFetch();

      // Mutation arrives during fetch: (0,0) = 99
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 99, display: '99', flags: VALUE_TYPE_NUMBER },
      ]);

      // Delta arrives — a strip of new rows (3,0)-(5,2) with the old value at (0,0)
      // Build a delta buffer as a 3x3 viewport starting at row 3
      const deltaBuffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 3,
        startCol: 0,
        isDelta: true,
        cells: [{ numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER }],
      });

      // Commit delta: expand viewport to (0,0)-(5,2)
      coordinator.commitDelta(deltaBuffer, 0, 0, 6, 3, epoch);

      // The overlay entry for (0,0)=99 should be re-applied
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(99);
      expect(displayStringOrNull(accessor.displayText)).toBe('99');

      // The delta cell at (3,0) should also be accessible
      accessor.moveTo(3, 0);
      expect(accessor.numberValue).toBe(10);
    });

    it('commitDelta preserves overflow pool strings from overlay', () => {
      // Start with a 3x3 viewport at (0,0)
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 0, display: 'original', flags: VALUE_TYPE_NUMBER }],
      });

      // Apply mutation to (0,0) with a display string — writes to overflow pool
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 0, display: 'mutated-text', flags: VALUE_TYPE_NUMBER },
      ]);

      // Start a fetch (captures epoch AFTER mutation, so epoch >= mutation epoch)
      const epoch = coordinator.startFetch();

      // Build a delta buffer as a 3x3 viewport starting at row 3
      const deltaBuffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 3,
        startCol: 0,
        isDelta: true,
        cells: [{ numberValue: 20, display: '20', flags: VALUE_TYPE_NUMBER }],
      });

      // Commit delta: expand viewport to 6 rows
      coordinator.commitDelta(deltaBuffer, 0, 0, 6, 3, epoch);

      // The mutated cell (0,0) should still show "mutated-text" via accessor.displayText
      // This tests that applyDelta carries overflow pool strings into the merged buffer
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(displayStringOrNull(accessor.displayText)).toBe('mutated-text');

      // Delta cell at (3,0) should also be accessible
      accessor.moveTo(3, 0);
      expect(accessor.numberValue).toBe(20);
    });

    it('overlay entries are pruned when viewport scrolls away (prevents memory leak)', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch
      const epoch = coordinator.startFetch();

      // Mutate cell (0,0) AFTER startFetch — overlay entry epoch > fetchEpoch
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 999, display: '999', flags: VALUE_TYPE_NUMBER },
      ]);

      // Commit fetch with a DIFFERENT viewport range (rows 100-102).
      // This simulates the user scrolling far away from row 0.
      const scrolledBuffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 100,
        startCol: 0,
        cells: [{ numberValue: 50, display: '50', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(scrolledBuffer, epoch);

      // The new viewport should contain the scrolled data
      const scrolledAccessor = coordinator.base.createAccessor();
      scrolledAccessor.moveTo(100, 0);
      expect(scrolledAccessor.numberValue).toBe(50);

      // Cell (0,0) is outside the new viewport. The overlay entry should have
      // been pruned by _filterAndReapplyCellOverlay (isInViewport check).
      // Verify by scrolling back: start a new fetch, commit with original viewport.
      const epoch2 = coordinator.startFetch();
      const backBuffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 0, display: '0', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(backBuffer, epoch2);

      // (0,0) should show the fetch value (0), NOT the old overlay (999),
      // because the overlay was pruned during the scroll-away commit.
      const backAccessor = coordinator.base.createAccessor();
      backAccessor.moveTo(0, 0);
      expect(backAccessor.numberValue).toBe(0);
      expect(displayStringOrNull(backAccessor.displayText)).toBe('0');
    });

    it('combined cell + dimension overlay entries are both re-applied after fetch-commit', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
        rowDimensions: [{ row: 0, height: 20 }],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch
      const epoch = coordinator.startFetch();

      // Apply cell mutation AFTER startFetch
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 42, display: '42', flags: VALUE_TYPE_NUMBER },
      ]);

      // Apply dimension patch AFTER startFetch
      coordinator.applyDimensionPatch('row', 0, 60, false);

      // Commit fetch with original buffer (cell=1, row height=20)
      const originalBuffer = buildTestViewportBuffer(viewportOpts);
      coordinator.commitFetch(originalBuffer, epoch);

      // Cell overlay should be re-applied
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(42);
      expect(displayStringOrNull(accessor.displayText)).toBe('42');

      // Dimension overlay should be re-applied
      const dim = coordinator.getRowDimension(0);
      expect(dim).not.toBeNull();
      expect(dim!.height).toBe(60);
      expect(dim!.hidden).toBe(false);
    });

    it('commitDelta rejects stale epoch — fresh data is preserved', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });

      // Start first fetch (epoch1)
      const epoch1 = coordinator.startFetch();

      // Apply mutation to advance version, then start second fetch (epoch2)
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 50, display: '50', flags: VALUE_TYPE_NUMBER },
      ]);
      const epoch2 = coordinator.startFetch();
      expect(epoch2).toBeGreaterThan(epoch1);

      // Commit the LATER fetch first (epoch2) — this is the "fresh" response
      const deltaBuffer2 = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 3,
        startCol: 0,
        isDelta: true,
        cells: [{ numberValue: 222, display: '222', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitDelta(deltaBuffer2, 0, 0, 6, 3, epoch2);

      // Verify data from the fresh delta
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(3, 0);
      expect(accessor.numberValue).toBe(222);

      const versionAfterFresh = coordinator.version;

      // Now the STALE delta (epoch1) arrives late
      const events: ViewportChangeEvent[] = [];
      coordinator.subscribe((e) => events.push(e));

      const deltaBuffer1 = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 6,
        startCol: 0,
        isDelta: true,
        cells: [{ numberValue: 111, display: '111', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitDelta(deltaBuffer1, 0, 0, 9, 3, epoch1);

      // Stale delta is silently rejected: data from fresh delta preserved
      accessor.moveTo(3, 0);
      expect(accessor.numberValue).toBe(222);

      // No event emitted for rejected commit
      expect(events).toHaveLength(0);

      // Version did not advance
      expect(coordinator.version).toBe(versionAfterFresh);
    });

    it('bgColorOverride and fontColorOverride round-trip through overlay', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch
      const epoch = coordinator.startFetch();

      // Mutation with non-zero bgColorOverride and fontColorOverride AFTER startFetch
      const buf = buildTestMutationBuffer({
        patches: [
          {
            row: 0,
            col: 0,
            numberValue: 42,
            display: '42',
            flags: VALUE_TYPE_NUMBER,
            bgColorOverride: 0xff0000ff, // red RGBA
            fontColorOverride: 0x00ff00ff, // green RGBA
          },
        ],
      });
      const reader = new BinaryMutationReader(buf);
      coordinator.applyMutationPatches(reader);

      // Commit fetch with ORIGINAL buffer (no color overrides)
      const originalBuffer = buildTestViewportBuffer(viewportOpts);
      coordinator.commitFetch(originalBuffer, epoch);

      // Overlay should have re-applied the color overrides to the new base buffer
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(42);
      // Verify color overrides survived the round-trip through overlay
      expect(accessor.getBgColorOverride()).not.toBeNull();
      expect(accessor.getFontColorOverride()).not.toBeNull();
    });

    it('dimension overlay entries are pruned when viewport scrolls away', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        rowDimensions: [{ row: 0, height: 20 }],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch
      const epoch = coordinator.startFetch();

      // Apply dimension patch AFTER startFetch — overlay entry epoch > fetchEpoch
      coordinator.applyDimensionPatch('row', 0, 60, false);

      // Commit fetch with a DIFFERENT viewport range (rows 100-102).
      // This simulates the user scrolling far away from row 0.
      const scrolledBuffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 100,
        startCol: 0,
        rowDimensions: [{ row: 100, height: 25 }],
      });
      coordinator.commitFetch(scrolledBuffer, epoch);

      // The new viewport should contain the scrolled data
      const dim100 = coordinator.getRowDimension(100);
      expect(dim100).not.toBeNull();
      expect(dim100!.height).toBe(25);

      // Row 0 is outside the new viewport. The dimension overlay entry should have
      // been pruned by _filterAndReapplyDimensionOverlay (out-of-viewport check).
      // Verify by scrolling back: start a new fetch, commit with original viewport.
      const epoch2 = coordinator.startFetch();
      const backBuffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        rowDimensions: [{ row: 0, height: 20 }],
      });
      coordinator.commitFetch(backBuffer, epoch2);

      // Row 0 should show the fetch value (height=20), NOT the old overlay (height=60),
      // because the dimension overlay was pruned during the scroll-away commit.
      const dimBack = coordinator.getRowDimension(0);
      expect(dimBack).not.toBeNull();
      expect(dimBack!.height).toBe(20);
    });

    it('3+ rapid mutations during single fetch are all retained and re-applied', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch
      const epoch = coordinator.startFetch();

      // Apply 3 mutations to different cells AFTER startFetch
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER },
      ]);
      applyTestMutation(coordinator, [
        { row: 1, col: 1, numberValue: 20, display: '20', flags: VALUE_TYPE_NUMBER },
      ]);
      applyTestMutation(coordinator, [
        { row: 2, col: 2, numberValue: 30, display: '30', flags: VALUE_TYPE_NUMBER },
      ]);

      // Commit fetch with original buffer (all empty cells)
      const originalBuffer = buildTestViewportBuffer(viewportOpts);
      coordinator.commitFetch(originalBuffer, epoch);

      // All 3 overlay entries should be retained and re-applied
      const accessor = coordinator.base.createAccessor();

      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(10);
      expect(displayStringOrNull(accessor.displayText)).toBe('10');

      accessor.moveTo(1, 1);
      expect(accessor.numberValue).toBe(20);
      expect(displayStringOrNull(accessor.displayText)).toBe('20');

      accessor.moveTo(2, 2);
      expect(accessor.numberValue).toBe(30);
      expect(displayStringOrNull(accessor.displayText)).toBe('30');
    });
  });

  // =========================================================================
  // D. Dimension Patch Path (tests 22-24)
  // =========================================================================

  describe('dimension patch path', () => {
    it('applyDimensionPatch updates base buffer', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        rowDimensions: [{ row: 0, height: 20 }],
      });

      coordinator.applyDimensionPatch('row', 0, 40, false);

      const dim = coordinator.getRowDimension(0);
      expect(dim).not.toBeNull();
      expect(dim!.row).toBe(0);
      expect(dim!.height).toBe(40);
      expect(dim!.hidden).toBe(false);
    });

    it('applyDimensionPatch emits dimensions-patched event', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        colDimensions: [{ col: 0, width: 80 }],
      });

      const events: ViewportChangeEvent[] = [];
      coordinator.subscribe((e) => events.push(e));

      coordinator.applyDimensionPatch('col', 0, 120, false);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('dimensions-patched');
      const dimEvent = events[0] as { type: 'dimensions-patched'; axis: 'row' | 'col' };
      expect(dimEvent.axis).toBe('col');
    });

    it('dimension patches stored in overlay and re-applied after fetch', () => {
      const viewportOpts = {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        rowDimensions: [{ row: 0, height: 20 }],
      };

      const { coordinator } = createReadyCoordinator('main', viewportOpts);

      // Start fetch
      const epoch = coordinator.startFetch();

      // Dimension patch AFTER startFetch
      coordinator.applyDimensionPatch('row', 0, 50, false);

      // Commit with original buffer (row 0 height=20)
      const originalBuffer = buildTestViewportBuffer(viewportOpts);
      coordinator.commitFetch(originalBuffer, epoch);

      // Overlay re-applied: dimension patch should be retained
      const dim = coordinator.getRowDimension(0);
      expect(dim).not.toBeNull();
      expect(dim!.row).toBe(0);
      expect(dim!.height).toBe(50);
      expect(dim!.hidden).toBe(false);
    });
  });

  // =========================================================================
  // E. Subscriber Notification Ordering (tests 21-23)
  // =========================================================================

  describe('subscriber notification ordering', () => {
    it('subscribers are notified synchronously during commitFetch', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
      });

      let versionInsideCallback = -1;
      coordinator.subscribe(() => {
        versionInsideCallback = coordinator.version;
      });

      // Second commitFetch triggers subscriber
      const buf = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 5, display: '5', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(buf, 0);

      // Inside callback, version should equal post-commit version
      expect(versionInsideCallback).toBe(coordinator.version);
      expect(versionInsideCallback).toBeGreaterThan(0);
    });

    it('subscribers are notified synchronously during applyMutationPatches', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });

      let versionInsideCallback = -1;
      coordinator.subscribe(() => {
        versionInsideCallback = coordinator.version;
      });

      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER },
      ]);

      // Inside callback, version should equal post-mutation version
      expect(versionInsideCallback).toBe(coordinator.version);
      expect(versionInsideCallback).toBeGreaterThan(1); // > initial version from commitFetch (1)
    });

    it('subscriber exception does not block other subscribers', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });

      const receivedEvents: ViewportChangeEvent[] = [];

      // First subscriber throws
      coordinator.subscribe(() => {
        throw new Error('subscriber exploded');
      });

      // Second subscriber records event
      coordinator.subscribe((e) => receivedEvents.push(e));

      // Suppress console.error output from the catch in _emit
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Trigger a fetch-committed event
      const buf = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 5, display: '5', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(buf, 0);

      // Second subscriber still received the event despite the first throwing
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('fetch-committed');

      // Verify the error was caught and logged
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('event types are correctly discriminated', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
        rowDimensions: [{ row: 0, height: 20 }],
      });

      const eventTypes: string[] = [];
      coordinator.subscribe((e) => eventTypes.push(e.type));

      // 1. Apply mutation -> cells-patched
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 10, display: '10', flags: VALUE_TYPE_NUMBER },
      ]);

      // 2. Apply dimension patch -> dimensions-patched
      coordinator.applyDimensionPatch('row', 0, 40, false);

      // 3. commitFetch -> fetch-committed
      const buf = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
      });
      coordinator.commitFetch(buf, 0);

      expect(eventTypes).toEqual(['cells-patched', 'dimensions-patched', 'fetch-committed']);
    });
  });

  // =========================================================================
  // F. Lifecycle Edge Cases & Epoch Boundary Tests
  // =========================================================================

  describe('lifecycle edge cases', () => {
    it('commitFetch after dispose is a no-op', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });

      const versionBeforeDispose = coordinator.version;

      // Start a fetch to get epoch
      const epoch = coordinator.startFetch();

      // Subscribe to verify no events fire after dispose
      const events: ViewportChangeEvent[] = [];
      coordinator.subscribe((e) => events.push(e));

      // Dispose the coordinator
      coordinator.dispose();

      // Build a new buffer and attempt commitFetch — should be a no-op
      const newBuffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 999, display: '999', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(newBuffer, epoch);

      // No event emitted (subscribers were cleared by dispose)
      expect(events).toHaveLength(0);

      // Version unchanged (commitFetch short-circuits on disposed)
      expect(coordinator.version).toBe(versionBeforeDispose);

      // No crash — test completes successfully
      expect(coordinator.disposed).toBe(true);
    });
  });

  describe('accessor consistency inside subscriber callback', () => {
    it('accessor reads inside subscriber callback see re-applied overlay', () => {
      // This directly tests Consistency Proof Point 4 from the architecture spec.
      // When commitFetch fires 'fetch-committed', the base buffer already has
      // overlay entries re-applied. A subscriber creating an accessor at that
      // moment must see the overlay value, not the raw fetch value.
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });

      // Start fetch to get epoch
      const epoch = coordinator.startFetch();

      // Apply mutation AFTER startFetch: overlay entry epoch > fetchEpoch
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER },
      ]);

      // Subscribe: inside callback, create accessor and read the cell
      let valueInsideCallback = NaN;
      coordinator.subscribe((event) => {
        if (event.type === 'fetch-committed') {
          const acc = coordinator.base.createAccessor();
          acc.moveTo(0, 0);
          valueInsideCallback = acc.numberValue;
        }
      });

      // Commit fetch with a buffer where cell (0,0) = 50 (Rust computed different value)
      const fetchBuffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 50, display: '50', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(fetchBuffer, epoch);

      // Inside the subscriber callback, the accessor should have read 100
      // (the overlay entry was re-applied because its epoch > fetchEpoch)
      expect(valueInsideCallback).toBe(100);
    });
  });

  describe('overlay vs fetch epoch boundary', () => {
    it('overlay entry wins over fetch data for same cell when epoch is newer', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });

      // Start fetch to get epoch
      const epoch = coordinator.startFetch();

      // Apply mutation AFTER startFetch: cell (0,0) = 100
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER },
      ]);

      // Build NEW buffer where cell (0,0) = 50 (Rust saw different dependencies)
      const fetchBuffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 50, display: '50', flags: VALUE_TYPE_NUMBER }],
      });
      coordinator.commitFetch(fetchBuffer, epoch);

      // Verify accessor reads 100, not 50 (overlay wins because epoch > fetchEpoch)
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(100);
      expect(displayStringOrNull(accessor.displayText)).toBe('100');
    });

    it('mutation between two startFetch calls is correctly filtered on second commit', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });

      // Step 2: startFetch() -> epoch1
      const epoch1 = coordinator.startFetch();

      // Step 3: Apply mutation M1: cell (0,0) = 100 (overlay epoch > epoch1)
      applyTestMutation(coordinator, [
        { row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER },
      ]);

      // Step 4: startFetch() -> epoch2 (epoch2 > M1's epoch, because M1 incremented version)
      const epoch2 = coordinator.startFetch();
      expect(epoch2).toBeGreaterThan(epoch1);

      // Step 5: Apply mutation M2: cell (0,1) = 200 (overlay epoch > epoch2)
      applyTestMutation(coordinator, [
        { row: 0, col: 1, numberValue: 200, display: '200', flags: VALUE_TYPE_NUMBER },
      ]);

      // Step 6: commitFetch(buffer, epoch2) — M1 has epoch <= epoch2, should be DISCARDED.
      //         M2 has epoch > epoch2, should be RETAINED.
      const fetchBuffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [
          { numberValue: 77, display: '77', flags: VALUE_TYPE_NUMBER },
          { numberValue: 88, display: '88', flags: VALUE_TYPE_NUMBER },
        ],
      });
      coordinator.commitFetch(fetchBuffer, epoch2);

      // Step 7: cell (0,0) reads the fetch buffer's value (M1 was discarded)
      const accessor = coordinator.base.createAccessor();
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(77);
      expect(displayStringOrNull(accessor.displayText)).toBe('77');

      // cell (0,1) reads 200 (M2 was retained and re-applied)
      accessor.moveTo(0, 1);
      expect(accessor.numberValue).toBe(200);
      expect(displayStringOrNull(accessor.displayText)).toBe('200');

      // Step 8: commitFetch(buffer, epoch1) — STALE, should be silently rejected
      const versionBefore = coordinator.version;
      const events: ViewportChangeEvent[] = [];
      coordinator.subscribe((e) => events.push(e));

      const staleBuffer = buildTestViewportBuffer({
        rows: 3,
        cols: 3,
        startRow: 0,
        startCol: 0,
        cells: [
          { numberValue: 999, display: '999', flags: VALUE_TYPE_NUMBER },
          { numberValue: 888, display: '888', flags: VALUE_TYPE_NUMBER },
        ],
      });
      coordinator.commitFetch(staleBuffer, epoch1);

      // Step 9: Verify state unchanged from step 7
      accessor.moveTo(0, 0);
      expect(accessor.numberValue).toBe(77);

      accessor.moveTo(0, 1);
      expect(accessor.numberValue).toBe(200);

      // No event emitted for stale commit
      expect(events).toHaveLength(0);

      // Version did not advance
      expect(coordinator.version).toBe(versionBefore);
    });
  });

  // =========================================================================
  // G. Metadata write methods (hasBuffer, setSheetId, setVisibleWindow)
  // =========================================================================

  describe('metadata write methods', () => {
    it('hasBuffer() returns false on fresh coordinator', () => {
      const coordinator = new ViewportCoordinator('main');
      expect(coordinator.hasBuffer()).toBe(false);
    });

    it('hasBuffer() returns true after commitFetch', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 10,
        cols: 5,
        startRow: 0,
        startCol: 0,
        cells: [{ display: 'test' }],
      });
      expect(coordinator.hasBuffer()).toBe(true);
    });

    it('setSheetId() is callable before buffer load', () => {
      const coordinator = new ViewportCoordinator('main');
      expect(() => coordinator.setSheetId('sheet-1')).not.toThrow();
    });

    it('setVisibleWindow() sets window readable via base.getVisibleWindow()', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 10,
        cols: 5,
        startRow: 0,
        startCol: 0,
        cells: [{ display: 'test' }],
      });

      const window = { sheetId: 'sheet-1', startRow: 2, startCol: 1, endRow: 8, endCol: 4 };
      coordinator.setVisibleWindow(window);
      expect(coordinator.base.getVisibleWindow()).toEqual(window);
    });

    it('setVisibleWindow(null) clears the window', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 10,
        cols: 5,
        startRow: 0,
        startCol: 0,
        cells: [{ display: 'test' }],
      });

      coordinator.setVisibleWindow({
        sheetId: 's',
        startRow: 0,
        startCol: 0,
        endRow: 5,
        endCol: 5,
      });
      coordinator.setVisibleWindow(null);
      expect(coordinator.base.getVisibleWindow()).toBeNull();
    });

    it('all metadata methods are no-ops after dispose()', () => {
      const { coordinator } = createReadyCoordinator('main', {
        rows: 10,
        cols: 5,
        startRow: 0,
        startCol: 0,
        cells: [{ display: 'test' }],
      });

      coordinator.dispose();

      expect(() => coordinator.setSheetId('new-sheet')).not.toThrow();
      expect(() => coordinator.setVisibleWindow(null)).not.toThrow();
      // hasBuffer() still works (read-only, not guarded by dispose)
      expect(coordinator.hasBuffer()).toBe(true);
    });
  });
});

// ===========================================================================
// F. Registry Tests (tests 24-27)
// ===========================================================================

describe('ViewportCoordinatorRegistry', () => {
  it('register creates new coordinator', () => {
    const registry = new ViewportCoordinatorRegistry();

    const coordinator = registry.register('main');

    expect(coordinator).toBeInstanceOf(ViewportCoordinator);
    expect(coordinator.viewportId).toBe('main');
    expect(registry.get('main')).toBe(coordinator);
    expect(registry.getView('main')).toBe(coordinator);
    expect(registry.size).toBe(1);
  });

  it('unregister disposes coordinator', () => {
    const registry = new ViewportCoordinatorRegistry();
    const coordinator = registry.register('main');

    registry.unregister('main');

    expect(registry.get('main')).toBeUndefined();
    expect(coordinator.disposed).toBe(true);
    expect(registry.size).toBe(0);
  });

  it('applyMultiViewportPatches routes to correct coordinators', () => {
    const registry = new ViewportCoordinatorRegistry();

    // Register and initialize two viewports
    const main = registry.register('main');
    const frozenR = registry.register('frozen-r');

    const mainBuffer = buildTestViewportBuffer({
      rows: 3,
      cols: 3,
      startRow: 0,
      startCol: 0,
      cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
    });
    main.commitFetch(mainBuffer, 0);

    const frozenRBuffer = buildTestViewportBuffer({
      rows: 3,
      cols: 3,
      startRow: 0,
      startCol: 0,
      cells: [{ numberValue: 2, display: '2', flags: VALUE_TYPE_NUMBER }],
    });
    frozenR.commitFetch(frozenRBuffer, 0);

    // Build packed multi-viewport patches
    const mainMutation = buildTestMutationBuffer({
      patches: [{ row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER }],
    });
    const frozenRMutation = buildTestMutationBuffer({
      patches: [{ row: 0, col: 0, numberValue: 200, display: '200', flags: VALUE_TYPE_NUMBER }],
    });

    const packed = buildPackedMultiViewportPatches([
      { viewportId: 'main', mutationBuffer: mainMutation },
      { viewportId: 'frozen-r', mutationBuffer: frozenRMutation },
    ]);

    // Apply
    registry.applyMultiViewportPatches(packed);

    // Verify main got 100
    const mainAccessor = registry.get('main')!.base.createAccessor();
    mainAccessor.moveTo(0, 0);
    expect(mainAccessor.numberValue).toBe(100);
    expect(displayStringOrNull(mainAccessor.displayText)).toBe('100');

    // Verify frozen-r got 200
    const frozenRAccessor = registry.get('frozen-r')!.base.createAccessor();
    frozenRAccessor.moveTo(0, 0);
    expect(frozenRAccessor.numberValue).toBe(200);
    expect(displayStringOrNull(frozenRAccessor.displayText)).toBe('200');
  });

  it('applyMultiViewportPatches with unknown viewport ID does not crash', () => {
    const registry = new ViewportCoordinatorRegistry();

    // Register and initialize only one viewport
    const main = registry.register('main');
    const mainBuffer = buildTestViewportBuffer({
      rows: 3,
      cols: 3,
      startRow: 0,
      startCol: 0,
      cells: [{ numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
    });
    main.commitFetch(mainBuffer, 0);

    // Build packed multi-viewport patches that include an unknown viewport ID
    const mainMutation = buildTestMutationBuffer({
      patches: [{ row: 0, col: 0, numberValue: 100, display: '100', flags: VALUE_TYPE_NUMBER }],
    });
    const unknownMutation = buildTestMutationBuffer({
      patches: [{ row: 0, col: 0, numberValue: 999, display: '999', flags: VALUE_TYPE_NUMBER }],
    });

    const packed = buildPackedMultiViewportPatches([
      { viewportId: 'main', mutationBuffer: mainMutation },
      { viewportId: 'does-not-exist', mutationBuffer: unknownMutation },
    ]);

    // Should not throw
    expect(() => registry.applyMultiViewportPatches(packed)).not.toThrow();

    // Known viewport should have received its patch correctly
    const mainAccessor = registry.get('main')!.base.createAccessor();
    mainAccessor.moveTo(0, 0);
    expect(mainAccessor.numberValue).toBe(100);
    expect(displayStringOrNull(mainAccessor.displayText)).toBe('100');
  });

  it('re-registering viewport after unregister yields fresh coordinator', () => {
    const registry = new ViewportCoordinatorRegistry();

    // Register and initialize viewport
    const c1 = registry.register('main');
    const buf1 = buildTestViewportBuffer({
      rows: 3,
      cols: 3,
      startRow: 0,
      startCol: 0,
      cells: [{ numberValue: 42, display: '42', flags: VALUE_TYPE_NUMBER }],
    });
    c1.commitFetch(buf1, 0);

    // Verify data is there
    const accessor1 = c1.base.createAccessor();
    accessor1.moveTo(0, 0);
    expect(accessor1.numberValue).toBe(42);

    // Unregister
    registry.unregister('main');
    expect(c1.disposed).toBe(true);
    expect(registry.get('main')).toBeUndefined();

    // Re-register same viewport ID
    const c2 = registry.register('main');

    // New coordinator should be fresh — no data from old one
    expect(c2).not.toBe(c1);
    expect(c2.disposed).toBe(false);
    expect(c2.version).toBe(0);
    expect(c2.getBounds()).toBeNull();
    expect(registry.get('main')).toBe(c2);
  });

  it('clear disposes all coordinators', () => {
    const registry = new ViewportCoordinatorRegistry();

    const c1 = registry.register('main');
    const c2 = registry.register('frozen-r');
    const c3 = registry.register('corner');

    registry.clear();

    expect(registry.size).toBe(0);
    expect(c1.disposed).toBe(true);
    expect(c2.disposed).toBe(true);
    expect(c3.disposed).toBe(true);
    expect(registry.get('main')).toBeUndefined();
  });

  it('setRenderScheduler caches scheduler on registry (buffer no longer owns scheduler)', () => {
    const registry = new ViewportCoordinatorRegistry();

    // Register a coordinator before setting the scheduler
    const c1 = registry.register('main');

    const mockScheduler = {
      markAllDirty: jest.fn(),
      markCellsDirty: jest.fn(),
      markGeometryDirty: jest.fn(),
    } as any;

    // Set scheduler — cached on registry, no longer injected into buffers.
    // Render scheduling is handled by coordinator subscriptions in renderer-execution.ts.
    registry.setRenderScheduler(mockScheduler);

    // Verify mutations work and scheduler is NOT called from buffer/coordinator
    c1.commitFetch(buildTestViewportBuffer({ rows: 2, cols: 2 }), 0);
    const mutBuf = buildTestMutationBuffer({
      patches: [{ row: 0, col: 0, numberValue: 99, display: '99', flags: VALUE_TYPE_NUMBER }],
    });
    const reader = new BinaryMutationReader(mutBuf);
    c1.applyMutationPatches(reader);
    expect(mockScheduler.markCellsDirty).not.toHaveBeenCalled();

    // Register a new coordinator — verify it works without scheduler injection
    const c2 = registry.register('frozen-r');
    c2.commitFetch(buildTestViewportBuffer({ rows: 1, cols: 1 }), 0);
    const mutBuf2 = buildTestMutationBuffer({
      patches: [{ row: 0, col: 0, numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
    });
    const reader2 = new BinaryMutationReader(mutBuf2);
    c2.applyMutationPatches(reader2);
    expect(mockScheduler.markCellsDirty).not.toHaveBeenCalled();
  });

  it('global subscriber receives events from all coordinators', () => {
    const registry = new ViewportCoordinatorRegistry();
    const events: ViewportChangeEvent[] = [];

    // Subscribe globally BEFORE registering coordinators
    const unsub = registry.subscribe((event) => events.push(event));

    // Register two coordinators
    const c1 = registry.register('vp-a');
    const c2 = registry.register('vp-b');

    // Load buffers so mutations work (use commitFetch — the proper write path)
    c1.commitFetch(buildTestViewportBuffer({ rows: 2, cols: 2 }), 0);
    c2.commitFetch(buildTestViewportBuffer({ rows: 2, cols: 2 }), 0);

    // Clear setup events so we only observe the test events below
    events.length = 0;

    // Trigger events on different coordinators
    c1.commitFetch(buildTestViewportBuffer({ rows: 2, cols: 2 }), 0);
    c2.applyDimensionPatch('row', 0, 30, false);

    // Global subscriber should receive events from both
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('fetch-committed');
    expect(events[1].type).toBe('dimensions-patched');

    // Unsubscribe and verify no more events
    unsub();
    c1.commitFetch(buildTestViewportBuffer({ rows: 2, cols: 2 }), 0);
    expect(events).toHaveLength(2); // No new events

    registry.clear();
  });

  // ===========================================================================
  // Current lifecycle (Provider Protocol §4) — Hydration backfill.
  //
  // When `Provider.attach()` replays persisted bytes via `syncApply`, the
  // generated viewport patches arrive at `applyMultiViewportPatches` BEFORE
  // the renderer has registered any coordinators. The patches are dropped
  // ("MISSED") but the registry now flags `_hydrationDeficit`. The next
  // coordinator-mount fires the bridge-wired handler, which kicks a
  // `forceRefreshAllViewports` so the new coordinator backfills from
  // current engine state.
  // ===========================================================================

  describe('hydration-deficit backfill', () => {
    it('arms hydrationDeficit when applyMultiViewportPatches drops a non-empty patch', () => {
      const registry = new ViewportCoordinatorRegistry();
      expect(registry.hasHydrationDeficit).toBe(false);

      // No coordinator registered yet — the patch will be dropped.
      const mutation = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, numberValue: 42, display: '42', flags: VALUE_TYPE_NUMBER }],
      });
      const packed = buildPackedMultiViewportPatches([
        { viewportId: 'main', mutationBuffer: mutation },
      ]);
      registry.applyMultiViewportPatches(packed);

      expect(registry.hasHydrationDeficit).toBe(true);
    });

    it('does NOT arm hydrationDeficit on empty patches (patchLen === 0)', () => {
      const registry = new ViewportCoordinatorRegistry();

      // Empty packet (viewportCount === 1, patchLen === 0).
      const packed = new Uint8Array(2 + 1 + 4 + 4);
      const view = new DataView(packed.buffer);
      view.setUint16(0, 1, true); // viewport count
      view.setUint8(2, 4); // id length
      packed[3] = 'm'.charCodeAt(0);
      packed[4] = 'a'.charCodeAt(0);
      packed[5] = 'i'.charCodeAt(0);
      packed[6] = 'n'.charCodeAt(0);
      view.setUint32(7, 0, true); // patchLen = 0
      // patch bytes empty

      registry.applyMultiViewportPatches(packed);
      expect(registry.hasHydrationDeficit).toBe(false);
    });

    it('fires hydration-deficit handler on first new-coordinator register after a drop', () => {
      const registry = new ViewportCoordinatorRegistry();
      let handlerCallCount = 0;
      registry.setOnHydrationDeficit(() => {
        handlerCallCount += 1;
      });

      // 1. Drop a patch (simulating Provider.attach replay before renderer mount).
      const mutation = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, numberValue: 7, display: '7', flags: VALUE_TYPE_NUMBER }],
      });
      const packed = buildPackedMultiViewportPatches([
        { viewportId: 'main', mutationBuffer: mutation },
      ]);
      registry.applyMultiViewportPatches(packed);
      expect(registry.hasHydrationDeficit).toBe(true);
      expect(handlerCallCount).toBe(0); // Not fired yet — register fires it.

      // 2. Renderer mounts and registers — handler fires, deficit clears.
      registry.register('main');
      expect(handlerCallCount).toBe(1);
      expect(registry.hasHydrationDeficit).toBe(false);

      // 3. Re-registering the same viewport does NOT re-fire the handler.
      registry.register('main');
      expect(handlerCallCount).toBe(1);
    });

    it('does NOT fire handler when no deficit exists', () => {
      const registry = new ViewportCoordinatorRegistry();
      let handlerCallCount = 0;
      registry.setOnHydrationDeficit(() => {
        handlerCallCount += 1;
      });

      // Cold register without any preceding drop — no recovery needed.
      registry.register('main');
      expect(handlerCallCount).toBe(0);
    });

    it('re-arms after handler fires: a second drop + register fires the handler again', () => {
      const registry = new ViewportCoordinatorRegistry();
      let handlerCallCount = 0;
      registry.setOnHydrationDeficit(() => {
        handlerCallCount += 1;
      });

      // First episode: drop → register fires handler.
      const m1 = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });
      registry.applyMultiViewportPatches(
        buildPackedMultiViewportPatches([{ viewportId: 'main', mutationBuffer: m1 }]),
      );
      registry.register('main');
      expect(handlerCallCount).toBe(1);

      // Second episode (e.g. websocket-collab arrives, then a second viewport
      // mounts — frozen rows/cols): drop, then register a NEW coordinator.
      const m2 = buildTestMutationBuffer({
        patches: [{ row: 1, col: 0, numberValue: 2, display: '2', flags: VALUE_TYPE_NUMBER }],
      });
      registry.applyMultiViewportPatches(
        buildPackedMultiViewportPatches([{ viewportId: 'frozen-r', mutationBuffer: m2 }]),
      );
      registry.register('frozen-r');
      expect(handlerCallCount).toBe(2);
    });

    it('handler swallowed errors do not block coordinator creation', () => {
      const registry = new ViewportCoordinatorRegistry();
      registry.setOnHydrationDeficit(() => {
        throw new Error('boom');
      });

      const m = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });
      registry.applyMultiViewportPatches(
        buildPackedMultiViewportPatches([{ viewportId: 'main', mutationBuffer: m }]),
      );

      // Suppress the expected `console.error` from the swallowed throw —
      // the test asserts robustness, the surfaced log is noise here.
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        // Register MUST still create the coordinator even though the
        // handler throws — the renderer's own subsequent refresh will
        // recover.
        const coord = registry.register('main');
        expect(coord).toBeInstanceOf(ViewportCoordinator);
        expect(registry.size).toBe(1);
        expect(registry.hasHydrationDeficit).toBe(false); // Cleared even on throw.
        expect(errSpy).toHaveBeenCalledWith(
          '[ViewportCoordinatorRegistry] hydration-deficit handler threw:',
          expect.any(Error),
        );
      } finally {
        errSpy.mockRestore();
      }
    });

    it('setOnHydrationDeficit(null) clears the handler; deficit flag stays armed', () => {
      const registry = new ViewportCoordinatorRegistry();
      let handlerCallCount = 0;
      registry.setOnHydrationDeficit(() => {
        handlerCallCount += 1;
      });
      registry.setOnHydrationDeficit(null);

      const m = buildTestMutationBuffer({
        patches: [{ row: 0, col: 0, numberValue: 1, display: '1', flags: VALUE_TYPE_NUMBER }],
      });
      registry.applyMultiViewportPatches(
        buildPackedMultiViewportPatches([{ viewportId: 'main', mutationBuffer: m }]),
      );
      registry.register('main');
      // No handler installed → no calls. Deficit flag stays armed since no
      // handler ran (the bridge isn't there to recover); a future register
      // call (after re-wiring a handler) will still be able to fire.
      expect(handlerCallCount).toBe(0);
      expect(registry.hasHydrationDeficit).toBe(true);
    });
  });
});
