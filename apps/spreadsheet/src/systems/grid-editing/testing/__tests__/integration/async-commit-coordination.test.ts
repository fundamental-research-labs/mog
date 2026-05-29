/**
 * Integration Test: Async Commit Coordination (xstate invoke)
 *
 * Verifies that the editor machine's `commitCellValue` invoke awaits the
 * async bridge call before transitioning out of `committing` — preventing
 * the race condition where the editor transitions to inactive before the
 * cell write completes.
 *
 * Bug #8: Cell doesn't re-render after edit+arrow key (race condition)
 *
 * The fix uses xstate `invoke` in the `committing` state. The machine stays
 * in `committing` while the bridge call is in flight, and transitions via
 * `onDone` (success) or `onError` (failure).
 *
 * @see machines/grid-editor-machine.ts — committing state invoke
 */

import { jest } from '@jest/globals';
import { sheetId as makeSheetId } from '@mog-sdk/contracts/core';

import { GridEditingSystem } from '../../../grid-editing-system';
import type { EditorDependencies } from '../../../types';
import { createEditableTestWorkbook } from '../../mock-workbook';

// =============================================================================
// Helpers
// =============================================================================

function createSystemWithAsyncCellWrite(
  setCellValue: (sheetId: string, row: number, col: number, value: string) => void | Promise<void>,
  editorDeps?: Partial<EditorDependencies>,
) {
  const testSheetId = makeSheetId('test-sheet');
  const system = new GridEditingSystem({
    initialSheetId: 'test-sheet',
    editorDeps: {
      setCellValue,
      ...editorDeps,
    },
  });
  system.start();

  // Set initial selection so there's an activeCell
  system.access.commands.selection.setSelection(
    [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
    { row: 0, col: 0 },
  );

  const editorActor = (system as any).editorActor;

  return {
    system,
    sheetId: testSheetId,
    editorActor,
    cleanup: () => {
      system.dispose();
    },
  };
}

/**
 * Flush enough microtasks for the full commit pipeline:
 * validating → (VALIDATION_SUCCESS) → committing → invoke starts
 */
async function flushMicrotasks(count = 6): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('commitCellValue invoke awaits bridge call', () => {
  it('editor stays in committing while setCellValue Promise is pending', async () => {
    let resolveWrite!: () => void;
    const writePromise = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });

    const { system, sheetId, editorActor, cleanup } = createSystemWithAsyncCellWrite(
      () => writePromise,
    );

    // Start editing and commit
    const cell = system.access.accessors.selection.getActiveCell();
    system.startEditing(cell, sheetId, 'hello');
    system.commitEdit('none');

    // Flush microtasks for validating → committing transition
    await flushMicrotasks();

    // Editor should be in committing state — invoke is pending
    const stateWhilePending = editorActor.getSnapshot();
    expect(stateWhilePending.matches('committing')).toBe(true);

    // Resolve the write
    resolveWrite();
    await writePromise;

    // Flush microtasks for invoke onDone
    await flushMicrotasks();

    // NOW editor should have transitioned to inactive via onDone
    const stateAfterResolve = editorActor.getSnapshot();
    expect(stateAfterResolve.matches('inactive')).toBe(true);

    cleanup();
  });

  it('transitions to inactive on setCellValue rejection (onError)', async () => {
    const { system, sheetId, editorActor, cleanup } = createSystemWithAsyncCellWrite(() =>
      Promise.reject(new Error('IPC failure')),
    );

    // Start editing and commit
    const cell = system.access.accessors.selection.getActiveCell();
    system.startEditing(cell, sheetId, 'hello');
    system.commitEdit('none');

    // Flush microtasks for validating → committing → invoke onError
    await flushMicrotasks();

    // Should still complete via onError — not stuck in committing
    const state = editorActor.getSnapshot();
    expect(state.matches('inactive')).toBe(true);

    cleanup();
  });

  it('synchronous setCellValue still works (backward compat)', async () => {
    const { system, sheetId, editorActor, cleanup } = createSystemWithAsyncCellWrite(() => {
      // Synchronous — returns void
    });

    // Start editing and commit
    const cell = system.access.accessors.selection.getActiveCell();
    system.startEditing(cell, sheetId, 'hello');
    system.commitEdit('none');

    // Flush microtasks for validating → committing → invoke onDone
    await flushMicrotasks();

    // Should complete — sync setCellValue wrapped in async invoke resolves immediately
    const state = editorActor.getSnapshot();
    expect(state.matches('inactive')).toBe(true);

    cleanup();
  });

  it('calls setCellValue with correct arguments', async () => {
    const calls: Array<{ sheetId: string; row: number; col: number; value: string }> = [];

    const { system, sheetId, editorActor, cleanup } = createSystemWithAsyncCellWrite(
      (sheetId, row, col, value) => {
        calls.push({ sheetId, row, col, value });
      },
    );

    const cell = system.access.accessors.selection.getActiveCell();
    system.startEditing(cell, sheetId, 'test-value');
    system.commitEdit('none');

    await flushMicrotasks();

    expect(editorActor.getSnapshot().matches('inactive')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      sheetId: 'test-sheet',
      row: 0,
      col: 0,
      value: 'test-value',
    });

    cleanup();
  });

  it('commits CSE array formulas to the pre-edit multi-cell selection', async () => {
    const testSheet = makeSheetId('test-sheet');
    const setCellValue = jest.fn();
    const setArrayFormula = jest.fn();
    const system = new GridEditingSystem({
      initialSheetId: 'test-sheet',
      workbook: createEditableTestWorkbook({ sheetId: testSheet }) as any,
      editorDeps: {
        setCellValue,
        setArrayFormula,
      },
    });
    system.start();

    try {
      system.access.commands.selection.setSelection(
        [{ startRow: 0, startCol: 3, endRow: 2, endCol: 3 }],
        { row: 0, col: 3 },
      );

      const cell = system.access.accessors.selection.getActiveCell();
      await system.beginEditSession({
        sheetId: testSheet,
        cell,
        entryMode: 'typing',
        initialTextHint: '=A1:A3*B1:B3',
      });

      expect(system.access.accessors.selection.getRanges()).toEqual([
        { startRow: 0, startCol: 3, endRow: 2, endCol: 3 },
      ]);
      expect(system.access.accessors.editor.getEditStartSelectionRanges()).toEqual([
        { startRow: 0, startCol: 3, endRow: 2, endCol: 3 },
      ]);

      system.access.commands.editor.enterArrayFormula();
      await flushMicrotasks();

      expect(setArrayFormula).toHaveBeenCalledTimes(1);
      expect(setArrayFormula).toHaveBeenCalledWith(
        testSheet,
        { startRow: 0, startCol: 3, endRow: 2, endCol: 3 },
        '=A1:A3*B1:B3',
      );
      expect(setCellValue).not.toHaveBeenCalled();
    } finally {
      system.dispose();
    }
  });

  it.each(['-300', '+300', '-.5', '+1.2e-3', '-12%'])(
    'commits signed numeric literal %s without formula syntax validation',
    async (value) => {
      const calls: Array<{ sheetId: string; row: number; col: number; value: string }> = [];
      const validateFormulaSyntax = jest.fn().mockResolvedValue('should not be called');

      const { system, sheetId, editorActor, cleanup } = createSystemWithAsyncCellWrite(
        (sheetId, row, col, value) => {
          calls.push({ sheetId, row, col, value });
        },
        { validateFormulaSyntax },
      );

      const cell = system.access.accessors.selection.getActiveCell();
      system.startEditing(cell, sheetId, value);
      system.commitEdit('none');

      await flushMicrotasks();

      expect(validateFormulaSyntax).not.toHaveBeenCalled();
      expect(editorActor.getSnapshot().matches('inactive')).toBe(true);
      expect(calls).toEqual([{ sheetId: 'test-sheet', row: 0, col: 0, value }]);

      cleanup();
    },
  );

  it('still validates leading-minus formula expressions', async () => {
    const validateFormulaSyntax = jest.fn().mockResolvedValue('formula error');

    const { system, sheetId, editorActor, cleanup } = createSystemWithAsyncCellWrite(jest.fn(), {
      validateFormulaSyntax,
    });

    const cell = system.access.accessors.selection.getActiveCell();
    system.startEditing(cell, sheetId, '-A1');
    system.commitEdit('none');

    await flushMicrotasks();

    expect(validateFormulaSyntax).toHaveBeenCalledWith(sheetId, '-A1', 0, 0);
    expect(editorActor.getSnapshot().matches('error')).toBe(true);

    cleanup();
  });

  it.each(['=A1', '=$A$1', '=SUM(A1)', '=A1:A1', '=Sheet1!A1', "='Sheet1'!A1"])(
    'blocks direct self-reference %s until iterative calculation is enabled',
    async (value) => {
      const setCellValue = jest.fn();
      let enableIterative!: () => void;
      let cancelEdit!: () => void;
      const onCircularReferenceWarning = jest.fn(
        (
          _cellAddress: string,
          _formula: string,
          onEnableIterative: () => void,
          onCancel: () => void,
        ) => {
          enableIterative = onEnableIterative;
          cancelEdit = onCancel;
        },
      );
      const validateCircularReference = jest.fn(
        async (_sheetId: string, row: number, col: number, formula: string) =>
          row === 0 && col === 0 ? { cellAddress: 'A1', formula } : null,
      );

      const { system, sheetId, editorActor, cleanup } = createSystemWithAsyncCellWrite(
        setCellValue,
        {
          validateFormulaSyntax: jest.fn().mockResolvedValue(null),
          validateCircularReference,
          onCircularReferenceWarning,
        },
      );

      const cell = system.access.accessors.selection.getActiveCell();
      system.startEditing(cell, sheetId, value);
      system.commitEdit('none');

      await flushMicrotasks();

      expect(validateCircularReference).toHaveBeenCalledWith(sheetId, 0, 0, value);
      expect(onCircularReferenceWarning).toHaveBeenCalledWith(
        'A1',
        value,
        expect.any(Function),
        expect.any(Function),
      );
      expect(editorActor.getSnapshot().matches('validating')).toBe(true);
      expect(setCellValue).not.toHaveBeenCalled();

      expect(cancelEdit).toEqual(expect.any(Function));
      enableIterative();
      await flushMicrotasks();

      expect(editorActor.getSnapshot().matches('inactive')).toBe(true);
      expect(setCellValue).toHaveBeenCalledWith('test-sheet', 0, 0, value);

      cleanup();
    },
  );

  it('cancels a direct self-reference warning without writing the formula', async () => {
    const setCellValue = jest.fn();
    let cancelEdit!: () => void;
    const onCircularReferenceWarning = jest.fn(
      (
        _cellAddress: string,
        _formula: string,
        _onEnableIterative: () => void,
        onCancel: () => void,
      ) => {
        cancelEdit = onCancel;
      },
    );

    const { system, sheetId, editorActor, cleanup } = createSystemWithAsyncCellWrite(setCellValue, {
      validateFormulaSyntax: jest.fn().mockResolvedValue(null),
      validateCircularReference: jest.fn().mockResolvedValue({ cellAddress: 'A1', formula: '=A1' }),
      onCircularReferenceWarning,
    });

    const cell = system.access.accessors.selection.getActiveCell();
    system.startEditing(cell, sheetId, '=A1');
    system.commitEdit('none');

    await flushMicrotasks();

    expect(editorActor.getSnapshot().matches('validating')).toBe(true);
    expect(setCellValue).not.toHaveBeenCalled();

    cancelEdit();
    await flushMicrotasks();

    expect(editorActor.getSnapshot().matches('inactive')).toBe(true);
    expect(setCellValue).not.toHaveBeenCalled();

    cleanup();
  });

  it('commits direct self-reference formulas when circular validation allows them', async () => {
    const setCellValue = jest.fn();
    const onCircularReferenceWarning = jest.fn();
    const validateCircularReference = jest.fn().mockResolvedValue(null);

    const { system, sheetId, editorActor, cleanup } = createSystemWithAsyncCellWrite(setCellValue, {
      validateFormulaSyntax: jest.fn().mockResolvedValue(null),
      validateCircularReference,
      onCircularReferenceWarning,
    });

    const cell = system.access.accessors.selection.getActiveCell();
    system.startEditing(cell, sheetId, '=A1');
    system.commitEdit('none');

    await flushMicrotasks();

    expect(validateCircularReference).toHaveBeenCalledWith(sheetId, 0, 0, '=A1');
    expect(onCircularReferenceWarning).not.toHaveBeenCalled();
    expect(editorActor.getSnapshot().matches('inactive')).toBe(true);
    expect(setCellValue).toHaveBeenCalledWith('test-sheet', 0, 0, '=A1');

    cleanup();
  });

  it('commits formula-shaped input literally in text-formatted cells', async () => {
    const testSheet = makeSheetId('test-sheet');
    const setCellValue = jest.fn();
    const validateFormulaSyntax = jest.fn().mockResolvedValue(null);
    const validateCircularReference = jest
      .fn()
      .mockResolvedValue({ cellAddress: 'A1', formula: '=A1+B1' });
    const system = new GridEditingSystem({
      initialSheetId: 'test-sheet',
      workbook: createEditableTestWorkbook({
        sheetId: testSheet,
        formats: { '0,0': { numberFormat: '@' } },
      }) as any,
      editorDeps: {
        setCellValue,
        validateFormulaSyntax,
        validateCircularReference,
      },
    });
    system.start();

    try {
      const cell = system.access.accessors.selection.getActiveCell();
      await system.beginEditSession({
        sheetId: testSheet,
        cell,
        entryMode: 'typing',
        initialTextHint: '=A1+B1',
      });
      system.commitEdit('none');
      await flushMicrotasks();

      expect(validateFormulaSyntax).not.toHaveBeenCalled();
      expect(validateCircularReference).not.toHaveBeenCalled();
      expect(setCellValue).toHaveBeenCalledWith(testSheet, 0, 0, '=A1+B1');
      expect((system as any).editorActor.getSnapshot().matches('inactive')).toBe(true);
    } finally {
      system.dispose();
    }
  });

  it('does not run circular detection when formula syntax validation fails', async () => {
    const validateCircularReference = jest
      .fn()
      .mockResolvedValue({ cellAddress: 'A1', formula: '=' });
    const onFormulaError = jest.fn();

    const { system, sheetId, editorActor, cleanup } = createSystemWithAsyncCellWrite(jest.fn(), {
      validateFormulaSyntax: jest.fn().mockResolvedValue('formula error'),
      validateCircularReference,
      onFormulaError,
    });

    const cell = system.access.accessors.selection.getActiveCell();
    system.startEditing(cell, sheetId, '=');
    system.commitEdit('none');

    await flushMicrotasks();

    expect(validateCircularReference).not.toHaveBeenCalled();
    expect(onFormulaError).toHaveBeenCalled();
    expect(editorActor.getSnapshot().matches('error')).toBe(true);

    cleanup();
  });

  it('does not get stuck when no editorDeps are provided', async () => {
    const testSheet = makeSheetId('test-sheet');
    const system = new GridEditingSystem({
      initialSheetId: 'test-sheet',
      // No editorDeps — commitCellValue invoke resolves immediately
    });
    system.start();

    system.access.commands.selection.setSelection(
      [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      { row: 0, col: 0 },
    );

    const editorActor = (system as any).editorActor;
    const cell = system.access.accessors.selection.getActiveCell();
    system.startEditing(cell, testSheet, 'hello');
    system.commitEdit('none');

    await flushMicrotasks();

    // Machine should not be stuck in committing
    expect(editorActor.getSnapshot().matches('inactive')).toBe(true);

    system.dispose();
  });
});
