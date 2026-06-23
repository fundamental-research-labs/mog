import type { CoreMutationCapture } from './semantic-mutation-capture-core-setup';
import { mutationResult } from './semantic-mutation-capture-test-helpers';

export function recordDirectCellEditScenario(capture: CoreMutationCapture): void {
  capture.mutationCapture.recordMutationResult({
    operation: 'compute_batch_set_cells_by_position',
    directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
    result: mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-a1',
            sheetId: 'sheet-1',
            position: { row: 0, col: 0 },
            oldFormula: '=1',
            newFormula: '=1+1',
            oldValue: 1,
            value: 2,
            extraFlags: 0,
          },
          {
            cellId: 'cell-b1',
            sheetId: 'sheet-1',
            position: { row: 0, col: 1 },
            oldValue: 10,
            value: 20,
            extraFlags: 0,
          },
        ],
        projectionChanges: [],
        errors: [],
        validationAnnotations: [],
        metrics: {},
      },
    }),
  });
}

export function recordDateAndTimeValueWriteScenario(capture: CoreMutationCapture): void {
  capture.mutationCapture.recordMutationResult({
    operation: 'compute_set_date_value',
    directEdits: [{ sheetId: 'sheet-1', row: 1, col: 2 }],
    result: mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-c2',
            sheetId: 'sheet-1',
            position: { row: 1, col: 2 },
            oldValue: null,
            value: 45291,
            extraFlags: 0,
          },
        ],
        projectionChanges: [],
        errors: [],
        validationAnnotations: [],
        metrics: {},
      },
    }),
  });
  capture.mutationCapture.recordMutationResult({
    operation: 'compute_set_time_value',
    directEdits: [{ sheetId: 'sheet-1', row: 2, col: 3 }],
    result: mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-d3',
            sheetId: 'sheet-1',
            position: { row: 2, col: 3 },
            oldValue: null,
            value: 0.5,
            extraFlags: 0,
          },
        ],
        projectionChanges: [],
        errors: [],
        validationAnnotations: [],
        metrics: {},
      },
    }),
  });
}
