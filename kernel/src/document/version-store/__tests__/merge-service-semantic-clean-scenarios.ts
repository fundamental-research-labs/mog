import { createWorkbookVersionMergeService } from '../merge-service';

import {
  graphWithRootAndDetachedChildren,
  rowColumnOrderChange,
  validSemanticPayload,
  valueChange,
} from './merge-service-semantic-helpers';

export function registerMergeServiceSemanticCleanScenarios() {
  it('previews disjoint cells.formulas and rows-columns records as clean changes', async () => {
    const formulaValue = { kind: 'formula', formula: '=SUM(A1:A2)', result: 3 };
    const rowInsert = rowColumnOrderChange('theirs-row-insert', 'sheet-1', 'row', 1, false, true);
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange(
          'ours-c1-formula',
          'cells.formulas',
          'sheet-1!C1',
          ['formula'],
          null,
          formulaValue,
        ),
      ]),
      theirsSemanticPayload: validSemanticPayload([rowInsert]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'clean',
      changes: expect.arrayContaining([
        expect.objectContaining({
          structural: expect.objectContaining({
            domain: 'cells.formulas',
            entityId: 'sheet-1!C1',
            propertyPath: ['formula'],
          }),
          merged: { kind: 'value', value: formulaValue },
        }),
        expect.objectContaining({
          structural: expect.objectContaining({
            domain: 'rows-columns',
            entityId: 'sheet-1!row:1',
            propertyPath: ['order'],
          }),
          merged: rowInsert.after,
        }),
      ]),
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });
}
