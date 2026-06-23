import {
  captureInput,
  createTestSemanticMutationCapture,
  expectCaptureMissingChangeSet,
  mutationResult,
} from './semantic-mutation-capture-test-helpers';

export function describeSheetStructuralInvalidEvidenceScenarios(): void {
  it('skips sheet structural records without stable identity or before/after evidence', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_create_sheet_with_default_col_width',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-index',
            kind: 'Set',
            field: 'sheet',
            name: 'No Index',
          },
          {
            sheetId: 'sheet-ambiguous-copy',
            kind: 'Set',
            field: 'sheet',
            name: 'Ambiguous',
            index: 1,
            sourceSheetId: 'source-sheet',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_delete_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-name',
            kind: 'Removed',
            field: 'sheet',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_copy_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-source',
            kind: 'Set',
            field: 'sheet',
            name: 'Missing Source',
            index: 2,
          },
          {
            sheetId: 'sheet-empty-source',
            kind: 'Set',
            field: 'sheet',
            name: 'Empty Source',
            index: 3,
            sourceSheetId: '',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_move_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-old-index',
            kind: 'Set',
            field: 'order',
            index: 0,
          },
          {
            sheetId: 'sheet-not-found-before',
            kind: 'Set',
            field: 'order',
            oldIndex: -1,
            index: 0,
          },
          {
            sheetId: '',
            kind: 'Set',
            field: 'order',
            oldIndex: 0,
            index: 1,
          },
        ],
      }),
    });

    expectCaptureMissingChangeSet(await capture.captureNormalCommit(captureInput()));
  });
}
