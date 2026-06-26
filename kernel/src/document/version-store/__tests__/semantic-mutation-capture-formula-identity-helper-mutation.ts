import type { FormulaIdentityCapture } from './semantic-mutation-capture-formula-identity-helper-capture';
import { mutationResult } from './semantic-mutation-capture-formula-test-helpers';

const FORMULA_IDENTITY_OPERATION = 'compute_batch_set_cells_by_position';
const FORMULA_IDENTITY_DIRECT_EDITS = [{ sheetId: 'sheet-1', row: 1, col: 0 }];

export async function recordCanonicalFormulaIdentityMutation(
  capture: FormulaIdentityCapture,
): Promise<void> {
  await capture.mutationCapture.recordPreMutation?.({
    operation: FORMULA_IDENTITY_OPERATION,
    directEdits: FORMULA_IDENTITY_DIRECT_EDITS,
  });
  capture.mutationCapture.recordMutationResult({
    operation: FORMULA_IDENTITY_OPERATION,
    directEdits: FORMULA_IDENTITY_DIRECT_EDITS,
    result: mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-a2',
            sheetId: 'sheet-1',
            position: { row: 1, col: 0 },
            oldValue: null,
            newFormula: '=A1+1',
            value: 43,
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
