import { createWorkbookVersionMergeService } from '../merge-service';
import {
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-fixtures';

export function registerMergeServiceInvalidPayloadBlockingScenarios() {
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
}
