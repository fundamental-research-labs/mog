import { createWorkbookVersionMergeService } from '../merge-service';
import {
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-fixtures';

describe('WorkbookVersionMergeService', () => {
  it('previews clean disjoint cells.values changes without mutating workbook state', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-b1', 'cells.values', 'sheet-1!B1', [], null, 'ready'),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge(
        {
          base: graph.rootCommitId,
          ours: graph.oursCommitId,
          theirs: graph.theirsCommitId,
        },
        { mode: 'preview' },
      ),
    ).resolves.toMatchObject({
      status: 'clean',
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
      changes: [
        expect.objectContaining({
          structural: expect.objectContaining({ entityId: 'sheet-1!A1' }),
          base: { kind: 'value', value: 1 },
          ours: { kind: 'value', value: 2 },
          merged: { kind: 'value', value: 2 },
        }),
        expect.objectContaining({
          structural: expect.objectContaining({ entityId: 'sheet-1!B1' }),
          base: { kind: 'value', value: null },
          theirs: { kind: 'value', value: 'ready' },
          merged: { kind: 'value', value: 'ready' },
        }),
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });

  it('orders clean disjoint changes by merge policy rather than branch role', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-b1', 'cells.values', 'sheet-1!B1', [], null, 'ready'),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
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
          structural: expect.objectContaining({ entityId: 'sheet-1!A1' }),
        }),
        expect.objectContaining({
          structural: expect.objectContaining({ entityId: 'sheet-1!B1' }),
        }),
      ],
    });
  });
});
