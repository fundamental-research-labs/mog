import { createWorkbookVersionMergeService } from '../merge-service';

import {
  formatChange,
  formatValue,
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
} from './merge-service-formats-helpers';

export function registerMergeServiceFormatsConflictScenarios() {
  it('classifies direct-format same-property edits as stable conflicts', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        formatChange('ours-a1-format', 'sheet-1!A1', null, formatValue({ bold: true })),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        formatChange('theirs-a1-format', 'sheet-1!A1', null, formatValue({ italic: true })),
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
            domain: 'cells.formats.direct',
            entityId: 'sheet-1!A1',
            propertyPath: ['format'],
          },
          base: { kind: 'value', value: null },
          ours: { kind: 'value', value: formatValue({ bold: true }) },
          theirs: { kind: 'value', value: formatValue({ italic: true }) },
        },
      ],
    });
    if (forward.status !== 'conflicted' || reversed.status !== 'conflicted') {
      throw new Error('expected both direct-format previews to conflict');
    }
    expect(forward.conflicts[0].conflictId).toBe(reversed.conflicts[0].conflictId);
    expect(forward.conflicts[0].conflictDigest).toBe(reversed.conflicts[0].conflictDigest);
    expect(forward.conflicts[0].structural).toEqual(reversed.conflicts[0].structural);
    expect(forward.conflicts[0].resolutionOptions.map((option) => option.optionId)).toEqual(
      reversed.conflicts[0].resolutionOptions.map((option) => option.optionId),
    );
  });

  it('classifies direct-format clear versus set as a conflict', async () => {
    const baseFormat = formatValue({ bold: true, fontColor: '#FF0000' });
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        formatChange('ours-a1-clear', 'sheet-1!A1', baseFormat, null),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        formatChange('theirs-a1-format', 'sheet-1!A1', baseFormat, formatValue({ italic: true })),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: graph.theirsCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'conflicted',
      changes: [],
      conflicts: [
        {
          structural: expect.objectContaining({
            domain: 'cells.formats.direct',
            entityId: 'sheet-1!A1',
            propertyPath: ['format'],
          }),
          base: { kind: 'value', value: baseFormat },
          ours: { kind: 'value', value: null },
          theirs: { kind: 'value', value: formatValue({ italic: true }) },
        },
      ],
      diagnostics: [],
    });
  });
}
