import { createWorkbookVersionDiffService } from '../diff-service';
import { addressDisplay, graphWithRootAndChild, semanticRecord } from './diff-service-fixtures';

export function registerDiffServiceProjectionRustScenarios(): void {
  it('projects Rust semantic changes when a payload has no review changes', async () => {
    const rustChanges = [
      semanticRecord({
        changeId: 'rust-cell-a1',
        domain: 'cell',
        entityId: 'sheet-1!A1',
        propertyPath: ['value'],
        before: null,
        after: 42,
        display: addressDisplay('A1'),
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: {
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticDiff',
          beforeStateDigest: 'before-digest',
          afterStateDigest: 'after-digest',
        },
        changes: rustChanges,
        semanticDiff: {
          beforeDigest: 'before-digest',
          afterDigest: 'after-digest',
          changes: rustChanges,
          diagnostics: [],
        },
        reviewChanges: [],
      },
    });
    const service = createWorkbookVersionDiffService({ provider });

    await expect(
      service.diff({ kind: 'commit', id: rootCommitId }, { kind: 'commit', id: childCommitId }),
    ).resolves.toMatchObject({
      status: 'success',
      items: rustChanges,
      diagnostics: [],
    });
  });
}
