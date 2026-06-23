import { createWorkbookVersionMergeService } from '../merge-service';

import {
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
} from './merge-service-semantic-helpers';

export function registerMergeServiceSemanticBlockingScenarios() {
  it('blocks opaque semantic diff records without leaking object identity', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        {
          changeId: 'opaque-formula-change',
          kind: 'updated',
          domainId: 'cells.formulas',
          objectId: 'formula:cell:secret-a1',
          objectKind: 'cell-formula',
          beforeDigest: { algorithm: 'opaque', value: 'opaque-before-secret' },
          afterDigest: { algorithm: 'opaque', value: 'opaque-after-secret' },
        },
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
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
          payload: expect.objectContaining({
            domain: 'cells.formulas',
            objectKind: 'cell-formula',
            reason: 'opaqueSemanticDiffRecord',
          }),
        }),
      ],
      mutationGuarantee: 'preview-only',
    });
    expect(JSON.stringify(result)).not.toContain('formula:cell:secret-a1');
    expect(JSON.stringify(result)).not.toContain('opaque-before-secret');
    expect(JSON.stringify(result)).not.toContain('opaque-after-secret');
  });
}
