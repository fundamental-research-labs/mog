import { createWorkbookVersionMergeService } from '../merge-service';
import {
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-fixtures';

export function registerMergeServiceUnsupportedDomainBlockingScenarios() {
  it('blocks disjoint metadata-domain changes the materializer cannot apply', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-sheet-name', 'sheet', 'sheet-1', ['name'], 'Sheet1', 'Forecast'),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange(
          'theirs-filter-state',
          'filters',
          'sheet-1:auto-filter',
          ['state'],
          'none',
          'active',
        ),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
          payload: expect.objectContaining({
            domain: 'filters',
            propertyPath: 'state',
          }),
        }),
      ],
      mutationGuarantee: 'preview-only',
    });
    expect(JSON.stringify(result)).not.toContain('Forecast');
    expect(JSON.stringify(result)).not.toContain('active');
  });

  it('classifies same-property sheet metadata changes as conflicts', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-sheet-name', 'sheet', 'sheet-1', ['name'], 'Sheet1', 'Forecast'),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-sheet-name', 'sheet', 'sheet-1', ['name'], 'Sheet1', 'Budget'),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'conflicted',
      changes: [],
      conflicts: [
        expect.objectContaining({
          conflictKind: 'same-property',
          structural: expect.objectContaining({
            domain: 'sheet',
            entityId: 'sheet-1',
            propertyPath: ['name'],
          }),
          base: { kind: 'value', value: 'Sheet1' },
          ours: { kind: 'value', value: 'Forecast' },
          theirs: { kind: 'value', value: 'Budget' },
        }),
      ],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });

  it('blocks unsupported semantic domains without fabricating merge output', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-pivot-source', 'pivot-tables', 'pivot-1', ['source'], 'A1:B10', 'C1:D10'),
      ]),
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_MERGE_UNSUPPORTED_DOMAIN' })],
      mutationGuarantee: 'preview-only',
    });
    expect(JSON.stringify(result)).not.toContain('C1:D10');
  });
}
