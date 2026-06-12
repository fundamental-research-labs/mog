/**
 * Integration Test: Commit Pipeline
 *
 * Verifies that the editor commit lifecycle completes automatically
 * with EditorCommitCoordination wired. No manual completeCommit() needed.
 *
 * Flow: startEditing → commitEdit → auto-validate → auto-commit → inactive
 *
 * @see coordination/editor-commit-coordination.ts
 */

import { createIntegrationSimulator, type IntegrationSimulator } from '../../integration-simulator';

// =============================================================================
// Test Setup
// =============================================================================

let sim: IntegrationSimulator;
const TEST_SHEET_ID = 'sheet-1';

afterEach(() => {
  sim?.destroy();
});

async function startFormulaEditingWithEntryMode(
  entryMode: 'F2' | 'doubleClick',
  formula = '=A1+B1',
): Promise<void> {
  const cell = sim.activeCell();
  const preEditSelectionRanges = sim.selectionRanges().map((range) => ({ ...range }));
  const rawSystem = sim.system as any;

  rawSystem.selectionActor.send({
    type: 'BEGIN_CELL_EDIT',
    cell,
  });
  rawSystem.editorActor.send({
    type: 'START_EDITING',
    cell,
    sheetId: TEST_SHEET_ID,
    initialValue: formula,
    entryMode,
    preEditSelectionRanges,
  });

  await sim.flush();
}

// =============================================================================
// Auto-Commit Lifecycle
// =============================================================================

describe('Auto-commit lifecycle (no manual completeCommit)', () => {
  it('edit and commit down auto-completes, moves selection', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 0, col: 0 },
    });

    sim.startEditing('hello');
    expect(sim.isEditing()).toBe(true);

    sim.commitEdit('down');
    await sim.flush();

    // Editor should have auto-completed (no manual VALIDATION_SUCCESS + COMMIT_COMPLETE)
    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });
  });

  it('edit and commit right auto-completes', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 2, col: 1 },
    });

    sim.startEditing('value');
    sim.commitEdit('right');
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 2, col: 2 });
  });

  it('edit and commit with none stays in place', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 3, col: 3 },
    });

    sim.startEditing('data');
    sim.commitEdit('none');
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 3, col: 3 });
  });
});

// =============================================================================
// Multiple Edit-Commit Cycles
// =============================================================================

describe('Multiple edit-commit cycles', () => {
  it('three consecutive edit-commit-down cycles', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 0, col: 0 },
    });

    // First edit
    sim.startEditing('a');
    sim.commitEdit('down');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });

    // Second edit
    sim.startEditing('b');
    sim.commitEdit('down');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 2, col: 0 });

    // Third edit
    sim.startEditing('c');
    sim.commitEdit('down');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 3, col: 0 });
  });

  it('alternating commit directions', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 5, col: 5 },
    });

    sim.startEditing('right');
    sim.commitEdit('right');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 5, col: 6 });

    sim.startEditing('down');
    sim.commitEdit('down');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 6, col: 6 });

    sim.startEditing('left');
    sim.commitEdit('left');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 6, col: 5 });

    sim.startEditing('up');
    sim.commitEdit('up');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 5, col: 5 });
  });
});

// =============================================================================
// Key-Aware Tab/Enter Commit Navigation
// =============================================================================

describe('Key-aware Tab/Enter commit navigation', () => {
  it('preserves Tab origin across edit starts so Enter returns to the start column', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 0, col: 1 },
    });

    sim.startEditing('B1');
    await sim.system.commitWithKey('tab');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 0, col: 2 });

    sim.startEditing('C1');
    await sim.system.commitWithKey('tab');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 0, col: 3 });

    sim.startEditing('D1');
    await sim.system.commitWithKey('enter');
    await sim.flush();

    expect(sim.activeCell()).toEqual({ row: 1, col: 1 });
  });

  it('preserves effective selection ranges across edit starts for Tab wrap', async () => {
    sim = createIntegrationSimulator();
    sim.system.access.commands.selection.setSelection(
      [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
      { row: 0, col: 0 },
    );

    sim.startEditing('X');
    await sim.system.commitWithKey('tab');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 0, col: 1 });
    expect(sim.selectionRanges()).toEqual([{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }]);

    sim.startEditing('Y');
    await sim.system.commitWithKey('tab');
    await sim.flush();

    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });
    expect(sim.selectionRanges()).toEqual([{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }]);
  });

  it('preserves context for Shift+Tab and Shift+Enter variants', async () => {
    sim = createIntegrationSimulator();
    sim.system.access.commands.selection.setSelection(
      [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
      { row: 1, col: 0 },
    );

    sim.startEditing('A2');
    await sim.system.commitWithKey('shift-tab');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 0, col: 1 });

    sim.destroy();
    sim = createIntegrationSimulator({
      activeCell: { row: 1, col: 1 },
    });

    sim.startEditing('B2');
    await sim.system.commitWithKey('tab');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 1, col: 2 });

    sim.startEditing('C2');
    await sim.system.commitWithKey('shift-enter');
    await sim.flush();

    expect(sim.activeCell()).toEqual({ row: 0, col: 1 });
  });

  it('keeps arrow commit as a real selection replacement that clears Tab origin', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 0, col: 1 },
    });

    sim.startEditing('B1');
    await sim.system.commitWithKey('tab');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 0, col: 2 });

    sim.startEditing('C1');
    sim.commitEdit('right');
    await sim.flush();
    expect(sim.activeCell()).toEqual({ row: 0, col: 3 });

    sim.startEditing('D1');
    await sim.system.commitWithKey('enter');
    await sim.flush();

    expect(sim.activeCell()).toEqual({ row: 1, col: 3 });
  });
});

// =============================================================================
// Cancel Edit
// =============================================================================

describe('Cancel edit', () => {
  it('cancel edit returns to idle without moving', () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 2, col: 2 },
    });

    sim.startEditing('test');
    expect(sim.isEditing()).toBe(true);

    sim.cancelEdit();
    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 2, col: 2 });
  });
});

// =============================================================================
// Formula Mode
// =============================================================================

describe('Formula editing mode', () => {
  it('starting with = enters formula editing state', () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 0, col: 0 },
    });

    sim.startEditing('=');
    expect(sim.isEditing()).toBe(true);
    expect(sim.isFormulaEditing()).toBe(true);
  });

  it('formula edit commit auto-completes', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 0, col: 0 },
    });

    sim.startEditing('=SUM(A2:A5)');
    sim.commitEdit('down');
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 1, col: 0 });
  });

  it('formula edit committed through the production Enter action advances from the edited cell', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 4, col: 2 },
    });

    sim.startEditing('=A1+B1');
    await sim.dispatch('COMMIT_ENTER');
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 5, col: 2 });
  });

  it('formula edit committed through the production Shift+Enter action moves upward', async () => {
    sim = createIntegrationSimulator({
      activeCell: { row: 4, col: 2 },
    });

    sim.startEditing('=A1+B1');
    await sim.dispatch('COMMIT_SHIFT_ENTER');
    await sim.flush();

    expect(sim.isEditing()).toBe(false);
    expect(sim.activeCell()).toEqual({ row: 3, col: 2 });
  });

  it.each([
    ['F2', 'COMMIT_ENTER', { row: 5, col: 2 }],
    ['doubleClick', 'COMMIT_ENTER', { row: 5, col: 2 }],
    ['F2', 'COMMIT_SHIFT_ENTER', { row: 3, col: 2 }],
    ['doubleClick', 'COMMIT_SHIFT_ENTER', { row: 3, col: 2 }],
  ] as const)(
    'formula edit started from %s follows production %s navigation',
    async (entryMode, commitAction, expectedActiveCell) => {
      sim = createIntegrationSimulator({
        activeCell: { row: 4, col: 2 },
      });

      await startFormulaEditingWithEntryMode(entryMode);
      expect(sim.isEditing()).toBe(true);

      await sim.dispatch(commitAction);
      await sim.flush();

      expect(sim.isEditing()).toBe(false);
      expect(sim.activeCell()).toEqual(expectedActiveCell);
    },
  );
});
