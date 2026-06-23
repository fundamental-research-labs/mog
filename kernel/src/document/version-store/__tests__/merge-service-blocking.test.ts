import { createWorkbookVersionMergeService } from '../merge-service';
import {
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-fixtures';

describe('WorkbookVersionMergeService', () => {
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
            domain: 'sheet',
            propertyPath: 'name',
          }),
        }),
      ],
      mutationGuarantee: 'preview-only',
    });
    expect(JSON.stringify(result)).not.toContain('Forecast');
    expect(JSON.stringify(result)).not.toContain('active');
  });

  it('blocks same-property metadata-domain changes before conflict classification', async () => {
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
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
          payload: expect.objectContaining({
            domain: 'sheet',
            propertyPath: 'name',
          }),
        }),
      ],
      mutationGuarantee: 'preview-only',
    });
    expect(JSON.stringify(result)).not.toContain('Forecast');
    expect(JSON.stringify(result)).not.toContain('Budget');
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

  it.each([
    [
      'empty domain',
      valueChange('ours-empty-domain', '', 'sheet-1', ['name'], 'Sheet1', 'Forecast'),
    ],
    ['empty entity', valueChange('ours-empty-entity', 'sheet', '', ['name'], 'Sheet1', 'Forecast')],
    [
      'empty property path',
      valueChange('ours-empty-property', 'sheet', 'sheet-1', [], 'Sheet1', 'Forecast'),
    ],
  ])('blocks malformed semantic records with %s', async (_label, change) => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([change]),
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
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNSUPPORTED_SCHEMA' })],
      mutationGuarantee: 'preview-only',
    });
    expect(JSON.stringify(result)).not.toContain('Forecast');
  });

  it('blocks redacted semantic records before classification', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        {
          ...valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
          after: { kind: 'redacted', reason: 'redaction-policy' },
        },
      ]),
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: graph.theirsCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_REDACTION_VIOLATION' })],
    });
  });

  it('blocks unsupported semantic change-set schemas', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: { schemaVersion: 2, changes: [] },
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: graph.theirsCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNSUPPORTED_SCHEMA' })],
    });
  });
});
