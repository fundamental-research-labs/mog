import 'fake-indexeddb/auto';

import { WorkbookVersionImpl } from '../version';
import { createMergePreviewArtifactRecord } from '../../../document/version-store/merge-attempt-artifacts';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import {
  HEAD_COMMIT_ID,
  PRINCIPAL_OTHER,
  PRINCIPAL_SECRET,
  RAW_CELL_VALUE,
  SECRET_PATH,
  SECRET_REF,
  SECRET_TABLE_ID,
  SECRET_TABLE_NAME,
  commitReviewFixture,
  conflictDigestObject,
  digest,
  expectMergeReviewDiagnostic,
  expectNoDiagnosticLeaks,
  mergeResultIdForReviewDigest,
  mergeReviewBaseInput,
  providerWithInitializedRegistry,
  tableDefinitionConflict,
} from './version-review-provider-access-test-utils';

describe('WorkbookVersion provider review access merge hardening', () => {
  it('redacts denied conflict detail diagnostics from provider artifact reads', async () => {
    const provider = await providerWithInitializedRegistry('denied-conflict-detail');
    const resultDigest = digest('8');
    const canaries = [
      PRINCIPAL_SECRET,
      `merge-result:${resultDigest.digest}`,
      `merge-payload:${resultDigest.digest}`,
      resultDigest.digest,
      'conflict:w9-04:secret',
      RAW_CELL_VALUE,
    ];
    const deniedProvider = {
      accessContext: { principalScope: PRINCIPAL_SECRET, diagnosticsAllowed: true },
      readGraphRegistry: () => provider.readGraphRegistry(),
      openGraph: async () => ({
        getObjectRecord: async () => {
          throw Object.assign(new Error(canaries.join(' ')), {
            diagnostics: [
              {
                issueCode: 'VERSION_PERMISSION_DENIED',
                safeMessage: `Denied conflict detail for ${canaries.join(' ')}`,
                payload: {
                  principalScope: PRINCIPAL_SECRET,
                  conflictId: 'conflict:w9-04:secret',
                  value: RAW_CELL_VALUE,
                },
              },
            ],
          });
        },
      }),
    };
    const version = new WorkbookVersionImpl({ versioning: { provider: deniedProvider } } as any);

    const result = await version.getMergeConflictDetail({
      ...mergeReviewBaseInput(resultDigest),
      conflictId: 'conflict:w9-04:secret',
      expectedConflictDigest: digest('9'),
      valueRole: 'base',
      purpose: 'review',
    });

    expectMergeReviewDiagnostic(
      result,
      'getMergeConflictDetail',
      'VERSION_PERMISSION_DENIED',
      'Version merge review is not authorized for this caller.',
    );
    expectNoDiagnosticLeaks(result, canaries);
  });

  it('rejects provider conflict detail when denied projections hide table definitions', async () => {
    const graphId = 'denied-conflict-detail-projection';
    const provider = await providerWithInitializedRegistry(graphId);
    const namespace = namespaceForDocumentScope(provider.documentScope, graphId);
    const graph = await provider.openGraph(namespace);
    const head = await graph.readHead();
    if (head.status !== 'success') throw new Error('expected initialized graph head');
    const oursCommit = await commitReviewFixture(graph, namespace, {
      expectedHeadCommitId: head.head.id,
      expectedMainRefVersion: head.head.refRevision as any,
      label: 'ours',
    });
    const theirsCommit = await commitReviewFixture(graph, namespace, {
      expectedHeadCommitId: oursCommit.commit.id,
      expectedMainRefVersion: oursCommit.main.revision,
      label: 'theirs',
    });
    const conflict = tableDefinitionConflict();
    const previewRecord = await createMergePreviewArtifactRecord(namespace, {
      status: 'conflicted',
      base: head.head.id,
      ours: oursCommit.commit.id,
      theirs: theirsCommit.commit.id,
      conflicts: [conflict],
    });
    const put = await graph.putObjects([previewRecord]);
    expect(put.status).toBe('success');
    const version = new WorkbookVersionImpl({ versioning: { provider } } as any);

    const result = await version.getMergeConflictDetail({
      resultId: mergeResultIdForReviewDigest(previewRecord.digest),
      resultDigest: previewRecord.digest,
      redactionPolicyDigest: previewRecord.digest,
      conflictId: conflict.conflictId,
      expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
      valueRole: 'theirs',
      purpose: 'review',
      targetRef: 'refs/heads/main' as any,
      expectedTargetHead: {
        commitId: oursCommit.commit.id,
        revision: oursCommit.main.revision,
      },
    });

    expectMergeReviewDiagnostic(
      result,
      'getMergeConflictDetail',
      'VERSION_INVALID_COMMIT_PAYLOAD',
      'Persisted merge preview artifact payload is invalid or unsupported.',
    );
    expectNoDiagnosticLeaks(result, [
      SECRET_TABLE_ID,
      SECRET_TABLE_NAME,
      SECRET_REF,
      PRINCIPAL_SECRET,
      conflict.conflictId,
      conflict.conflictDigest,
      previewRecord.digest.digest,
    ]);
  });

  it('redacts principal mismatch and saved-resolution payload refs in provider diagnostics', async () => {
    const resultDigest = digest('7');
    const payloadId = `merge-payload:${resultDigest.digest}`;
    const resultId = mergeResultIdForReviewDigest(resultDigest);
    const canaries = [
      PRINCIPAL_SECRET,
      PRINCIPAL_OTHER,
      payloadId,
      resultId,
      resultDigest.digest,
      `sha256:${resultDigest.digest}`,
      RAW_CELL_VALUE,
      SECRET_PATH,
    ];
    const deniedProvider = {
      accessContext: { principalScope: PRINCIPAL_SECRET, diagnosticsAllowed: true },
      readGraphRegistry: async () => ({
        status: 'unsupported',
        registry: null,
        diagnostics: [
          {
            issueCode: 'VERSION_PERMISSION_DENIED',
            recoverability: 'unsupported',
            safeMessage: `Principal mismatch ${canaries.join(' ')}`,
            payload: {
              principalScope: PRINCIPAL_SECRET,
              expectedPrincipalScope: PRINCIPAL_SECRET,
              actualPrincipalScope: PRINCIPAL_OTHER,
              payloadId,
              resolutionSetDigest: resultDigest.digest,
              value: RAW_CELL_VALUE,
              path: SECRET_PATH,
            },
          },
        ],
      }),
      openGraph: async () => {
        throw new Error('openGraph should not be called');
      },
    };
    const version = new WorkbookVersionImpl({ versioning: { provider: deniedProvider } } as any);

    const saved = await version.saveMergeResolutions({
      resultId,
      resultDigest,
      redactionPolicyDigest: resultDigest,
      resolutions: [],
    });
    const payload = await version.putMergeResolutionPayload({
      resultId,
      resultDigest,
      redactionPolicyDigest: resultDigest,
      conflictId: 'conflict:w9-04:payload-ref',
      expectedConflictDigest: digest('6'),
      optionId: 'option:w9-04:payload-ref',
      kind: 'acceptTheirs',
      targetRef: 'refs/heads/main',
      expectedTargetHead: {
        commitId: HEAD_COMMIT_ID,
        revision: 'rv:w9-04-head',
      },
      value: RAW_CELL_VALUE,
      purpose: 'chooseValue',
    });

    for (const [result, operation] of [
      [saved, 'saveMergeResolutions'],
      [payload, 'putMergeResolutionPayload'],
    ] as const) {
      expectMergeReviewDiagnostic(
        result,
        operation,
        'VERSION_PERMISSION_DENIED',
        'Version merge review is not authorized for this caller.',
      );
      expectNoDiagnosticLeaks(result, canaries);
    }
  });
});
