import { createWorkbookVersionMergeService } from '../merge-service';

import {
  graphWithRootAndDetachedChildren,
  rowColumnOrderChange,
  rowColumnValue,
  validSemanticPayload,
  valueChange,
} from './merge-service-semantic-helpers';

export function registerMergeServiceSemanticConflictScenarios() {
  it('classifies cells.formulas same-property records as stable conflicts', async () => {
    const oursFormula = { kind: 'formula', formula: '=A1+1', result: 2 };
    const theirsFormula = { kind: 'formula', formula: '=A1+2', result: 3 };
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange(
          'ours-c1-formula',
          'cells.formulas',
          'sheet-1!C1',
          ['formula'],
          null,
          oursFormula,
        ),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-c1-formula', 'cells.formulas', 'sheet-1!C1', [], null, theirsFormula),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const forward = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });
    const reversed = await service.merge({
      base: graph.rootCommitId,
      ours: graph.theirsCommitId,
      theirs: graph.oursCommitId,
    });

    expect(forward).toMatchObject({
      status: 'conflicted',
      changes: [],
      conflicts: [
        {
          conflictKind: 'same-property',
          structural: {
            kind: 'metadata',
            domain: 'cells.formulas',
            entityId: 'sheet-1!C1',
            propertyPath: ['formula'],
          },
          base: { kind: 'value', value: null },
          ours: { kind: 'value', value: oursFormula },
          theirs: { kind: 'value', value: theirsFormula },
        },
      ],
    });
    if (forward.status !== 'conflicted' || reversed.status !== 'conflicted') {
      throw new Error('expected both formula previews to conflict');
    }
    expect(forward.conflicts[0].conflictId).toBe(reversed.conflicts[0].conflictId);
    expect(forward.conflicts[0].conflictDigest).toBe(reversed.conflicts[0].conflictDigest);
    expect(forward.conflicts[0].structural).toEqual(reversed.conflicts[0].structural);
  });

  it('classifies rows-columns same-order records as stable conflicts', async () => {
    const rowValue = rowColumnValue('sheet-1', 'row', 1);
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        rowColumnOrderChange('ours-row-delete', 'sheet-1', 'row', 1, true, false),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        rowColumnOrderChange('theirs-row-keep', 'sheet-1', 'row', 1, true, true),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const forward = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });
    const reversed = await service.merge({
      base: graph.rootCommitId,
      ours: graph.theirsCommitId,
      theirs: graph.oursCommitId,
    });

    expect(forward).toMatchObject({
      status: 'conflicted',
      changes: [],
      conflicts: [
        {
          conflictKind: 'same-property',
          structural: {
            kind: 'metadata',
            domain: 'rows-columns',
            entityId: 'sheet-1!row:1',
            propertyPath: ['order'],
          },
          base: { kind: 'value', value: rowValue },
          ours: { kind: 'value', value: null },
          theirs: { kind: 'value', value: rowValue },
        },
      ],
    });
    if (forward.status !== 'conflicted' || reversed.status !== 'conflicted') {
      throw new Error('expected both rows-columns previews to conflict');
    }
    expect(forward.conflicts[0].conflictId).toBe(reversed.conflicts[0].conflictId);
    expect(forward.conflicts[0].conflictDigest).toBe(reversed.conflicts[0].conflictDigest);
    expect(forward.conflicts[0].structural).toEqual(reversed.conflicts[0].structural);
  });
}
