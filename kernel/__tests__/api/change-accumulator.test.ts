/**
 * Unit tests for ChangeAccumulator — both per-sheet and workbook-level tracking.
 *
 * Tests the fan-out logic, origin tagging, and workbook tracker ingestion
 * without requiring the native addon or full kernel context.
 */

import {
  ChangeAccumulator,
  type TrackerHandle,
  type WorkbookTrackerHandle,
  type CellChangeInfo,
} from '../../src/api/worksheet/change-accumulator';
import type { ChangeRecord } from '@mog-sdk/contracts/api';

// =============================================================================
// Helpers
// =============================================================================

/** Create a mock per-sheet TrackerHandle that captures ingested records. */
function createMockSheetTracker(sheetId: string): TrackerHandle & { records: ChangeRecord[] } {
  const records: ChangeRecord[] = [];
  return {
    sheetId,
    records,
    _ingest(incoming: ChangeRecord[]) {
      records.push(...incoming);
    },
  };
}

/** Create a mock WorkbookTrackerHandle that captures ingested records by sheet. */
function createMockWorkbookTracker(): WorkbookTrackerHandle & {
  calls: Array<Map<string, ChangeRecord[]>>;
  allRecords: ChangeRecord[];
} {
  const calls: Array<Map<string, ChangeRecord[]>> = [];
  const allRecords: ChangeRecord[] = [];
  return {
    calls,
    allRecords,
    _ingestBySheet(recordsBySheet: Map<string, ChangeRecord[]>) {
      calls.push(new Map(recordsBySheet));
      for (const records of recordsBySheet.values()) {
        allRecords.push(...records);
      }
    },
  };
}

function makeChangedCells(
  cells: Array<{ sheetId: string; row: number; col: number }>,
): CellChangeInfo[] {
  return cells;
}

// =============================================================================
// Per-sheet tracker tests
// =============================================================================

describe('ChangeAccumulator — per-sheet trackers', () => {
  it('fans out records to matching sheet tracker', () => {
    const acc = new ChangeAccumulator();
    const tracker = createMockSheetTracker('sheet-1');
    acc.register(tracker);

    acc.ingest(
      makeChangedCells([
        { sheetId: 'sheet-1', row: 0, col: 0 },
        { sheetId: 'sheet-2', row: 0, col: 0 }, // different sheet — should not reach tracker
      ]),
      null,
      'user',
    );

    expect(tracker.records).toHaveLength(1);
    expect(tracker.records[0].address).toBe('A1');
  });

  it('tags direct vs cascade origins', () => {
    const acc = new ChangeAccumulator();
    const tracker = createMockSheetTracker('sheet-1');
    acc.register(tracker);

    acc.ingest(
      makeChangedCells([
        { sheetId: 'sheet-1', row: 0, col: 0 }, // direct
        { sheetId: 'sheet-1', row: 1, col: 0 }, // cascade (not in directEdits)
      ]),
      [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      'user',
    );

    expect(tracker.records).toHaveLength(2);
    expect(tracker.records[0].origin).toBe('direct');
    expect(tracker.records[1].origin).toBe('cascade');
  });

  it('tags remote origin for remote source', () => {
    const acc = new ChangeAccumulator();
    const tracker = createMockSheetTracker('sheet-1');
    acc.register(tracker);

    acc.ingest(makeChangedCells([{ sheetId: 'sheet-1', row: 0, col: 0 }]), null, 'remote');

    expect(tracker.records[0].origin).toBe('remote');
  });

  it('does nothing when no trackers are registered', () => {
    const acc = new ChangeAccumulator();
    // Should not throw
    acc.ingest(makeChangedCells([{ sheetId: 'sheet-1', row: 0, col: 0 }]), null, 'user');
    expect(acc.activeCount).toBe(0);
  });

  it('consumes pending direct edits', () => {
    const acc = new ChangeAccumulator();
    const tracker = createMockSheetTracker('sheet-1');
    acc.register(tracker);

    acc.setDirectEdits([{ sheetId: 'sheet-1', row: 0, col: 0 }]);
    acc.ingest(
      makeChangedCells([
        { sheetId: 'sheet-1', row: 0, col: 0 },
        { sheetId: 'sheet-1', row: 1, col: 0 },
      ]),
      null, // directEdits is null — should fall back to pending
      'user',
    );

    expect(tracker.records[0].origin).toBe('direct');
    expect(tracker.records[1].origin).toBe('cascade');
  });

  it('unregister removes tracker', () => {
    const acc = new ChangeAccumulator();
    const tracker = createMockSheetTracker('sheet-1');
    acc.register(tracker);
    expect(acc.activeCount).toBe(1);

    acc.unregister(tracker);
    expect(acc.activeCount).toBe(0);
  });
});

// =============================================================================
// Workbook-level tracker tests
// =============================================================================

describe('ChangeAccumulator — workbook-level trackers', () => {
  it('receives records from all sheets', () => {
    const acc = new ChangeAccumulator();
    const wbTracker = createMockWorkbookTracker();
    acc.registerWorkbook(wbTracker);

    acc.ingest(
      makeChangedCells([
        { sheetId: 'sheet-1', row: 0, col: 0 },
        { sheetId: 'sheet-2', row: 1, col: 1 },
      ]),
      null,
      'user',
    );

    expect(wbTracker.calls).toHaveLength(1);
    const call = wbTracker.calls[0];
    expect(call.has('sheet-1')).toBe(true);
    expect(call.has('sheet-2')).toBe(true);
    expect(wbTracker.allRecords).toHaveLength(2);
  });

  it('preserves origin tagging for workbook trackers', () => {
    const acc = new ChangeAccumulator();
    const wbTracker = createMockWorkbookTracker();
    acc.registerWorkbook(wbTracker);

    acc.ingest(
      makeChangedCells([
        { sheetId: 'sheet-1', row: 0, col: 0 },
        { sheetId: 'sheet-1', row: 1, col: 0 },
      ]),
      [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      'user',
    );

    const records = wbTracker.allRecords;
    expect(records[0].origin).toBe('direct');
    expect(records[1].origin).toBe('cascade');
  });

  it('works alongside per-sheet trackers', () => {
    const acc = new ChangeAccumulator();
    const sheetTracker = createMockSheetTracker('sheet-1');
    const wbTracker = createMockWorkbookTracker();
    acc.register(sheetTracker);
    acc.registerWorkbook(wbTracker);

    acc.ingest(
      makeChangedCells([
        { sheetId: 'sheet-1', row: 0, col: 0 },
        { sheetId: 'sheet-2', row: 0, col: 0 },
      ]),
      null,
      'user',
    );

    // Per-sheet tracker only gets sheet-1
    expect(sheetTracker.records).toHaveLength(1);
    // Workbook tracker gets both
    expect(wbTracker.allRecords).toHaveLength(2);
    expect(acc.activeCount).toBe(2);
  });

  it('unregisterWorkbook removes workbook tracker', () => {
    const acc = new ChangeAccumulator();
    const wbTracker = createMockWorkbookTracker();
    acc.registerWorkbook(wbTracker);
    expect(acc.activeCount).toBe(1);

    acc.unregisterWorkbook(wbTracker);
    expect(acc.activeCount).toBe(0);
  });

  it('threads before and after snapshots from CellChangeInfo to ChangeRecord', () => {
    const acc = new ChangeAccumulator();
    const wbTracker = createMockWorkbookTracker();
    acc.registerWorkbook(wbTracker);

    acc.ingest(
      [
        {
          sheetId: 'sheet-1',
          row: 0,
          col: 0,
          value: 42,
          displayText: '42',
          oldValue: 10,
          oldDisplayText: '10',
          oldFormula: '=A1',
          newFormula: '=A1*2',
          numberFormat: '0.00',
        },
        { sheetId: 'sheet-1', row: 1, col: 0, value: 'hello' },
      ],
      null,
      'user',
    );

    expect(wbTracker.allRecords[0].oldValue).toBe(10);
    expect(wbTracker.allRecords[0].oldDisplayValue).toBe('10');
    expect(wbTracker.allRecords[0].oldFormula).toBe('=A1');
    expect(wbTracker.allRecords[0].newValue).toBe(42);
    expect(wbTracker.allRecords[0].newDisplayValue).toBe('42');
    expect(wbTracker.allRecords[0].newFormula).toBe('=A1*2');
    expect(wbTracker.allRecords[0].numberFormat).toBe('0.00');
    expect(wbTracker.allRecords[1].oldValue).toBeUndefined();
    expect(wbTracker.allRecords[1].oldDisplayValue).toBeUndefined();
    expect(wbTracker.allRecords[1].oldFormula).toBeNull();
    expect(wbTracker.allRecords[1].newValue).toBe('hello');
    expect(wbTracker.allRecords[1].newFormula).toBeNull();
  });

  it('generates correct A1 addresses', () => {
    const acc = new ChangeAccumulator();
    const wbTracker = createMockWorkbookTracker();
    acc.registerWorkbook(wbTracker);

    acc.ingest(
      makeChangedCells([
        { sheetId: 'sheet-1', row: 0, col: 0 }, // A1
        { sheetId: 'sheet-1', row: 0, col: 25 }, // Z1
        { sheetId: 'sheet-1', row: 0, col: 26 }, // AA1
        { sheetId: 'sheet-1', row: 9, col: 2 }, // C10
      ]),
      null,
      'user',
    );

    const addresses = wbTracker.allRecords.map((r) => r.address);
    expect(addresses).toEqual(['A1', 'Z1', 'AA1', 'C10']);
  });
});
