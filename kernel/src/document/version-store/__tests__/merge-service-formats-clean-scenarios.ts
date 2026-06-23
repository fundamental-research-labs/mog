import { createWorkbookVersionMergeService } from '../merge-service';

import {
  formatChange,
  formatValue,
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-formats-helpers';

export function registerMergeServiceFormatsCleanScenarios() {
  it('previews same-cell value and direct-format edits as clean independent changes', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1-value', 'cells.values', 'sheet-1!A1', [], null, 'done'),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        formatChange('theirs-a1-format', 'sheet-1!A1', null, formatValue({ bold: true })),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'clean',
      changes: [
        expect.objectContaining({
          structural: expect.objectContaining({
            domain: 'cells.values',
            entityId: 'sheet-1!A1',
            propertyPath: [],
          }),
          merged: { kind: 'value', value: 'done' },
        }),
        expect.objectContaining({
          structural: expect.objectContaining({
            domain: 'cells.formats.direct',
            entityId: 'sheet-1!A1',
            propertyPath: ['format'],
          }),
          merged: { kind: 'value', value: formatValue({ bold: true }) },
        }),
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });
}
