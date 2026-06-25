import type { createTestSemanticMutationCapture } from './semantic-mutation-capture-test-helpers';
import { mutationResult } from './semantic-mutation-capture-test-helpers';

type TestSemanticMutationCapture = ReturnType<typeof createTestSemanticMutationCapture>;

export function recordSheetStructuralLifecycleMutations(
  capture: TestSemanticMutationCapture,
): void {
  capture.mutationCapture.recordMutationResult({
    operation: 'compute_create_sheet_with_default_col_width',
    result: mutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-created',
          kind: 'Set',
          field: 'sheet',
          name: 'Forecast',
          index: 1,
        },
        {
          sheetId: 'sheet-created',
          kind: 'Set',
          field: 'name',
          name: 'Forecast',
        },
        {
          sheetId: 'sheet-created',
          kind: 'Set',
          field: 'order',
          index: 1,
        },
      ],
    }),
  });
  capture.mutationCapture.recordMutationResult({
    operation: 'compute_delete_sheet',
    result: mutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-deleted',
          kind: 'Removed',
          field: 'sheet',
          name: 'Scratch',
        },
      ],
    }),
  });
  capture.mutationCapture.recordMutationResult({
    operation: 'compute_copy_sheet',
    result: mutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-copy',
          kind: 'Set',
          field: 'sheet',
          name: 'Forecast Copy',
          index: 2,
          sourceSheetId: 'sheet-created',
        },
        {
          sheetId: 'sheet-copy',
          kind: 'Set',
          field: 'order',
          index: 2,
        },
      ],
    }),
  });
  capture.mutationCapture.recordMutationResult({
    operation: 'compute_move_sheet',
    result: mutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-created',
          kind: 'Set',
          field: 'order',
          oldIndex: 1,
          index: 0,
        },
      ],
    }),
  });
}
