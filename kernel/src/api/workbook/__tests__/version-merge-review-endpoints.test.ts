import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  mergeResolutionSetArtifactRef,
  resolvedMergeAttemptArtifactRef,
} from '../../../document/version-store/merge-attempt-artifacts';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import {
  accessDeniedPreviewArtifactResult,
  conflictDigestObject,
  expectNoDiagnosticLeaks,
  expectPublicDiagnostic,
  expectStableConflictOptions,
  formulaConflict,
  MERGE_REVIEW_DOCUMENT_ID,
  readSyntheticConflictDetail,
  redactedStructuralConflict,
  resolutionFor,
  rowColumnConflict,
  rowColumnFields,
  stableOptionIds,
  withPersistedConflictPreview,
  withSyntheticConflictPreview,
} from './version-merge-review-endpoints-test-utils';

describe('WorkbookVersion merge review endpoints', () => {
  it('reads conflict detail from a persisted merge preview artifact', async () => {
    await withPersistedConflictPreview('detail-readback', async ({ sourceWb, preview }) => {
      const conflict = preview.conflicts[0];
      const detail = await sourceWb.version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'theirs',
        purpose: 'review',
      });

      expect(detail).toMatchObject({
        ok: true,
        value: {
          schemaVersion: 1,
          kind: 'reviewValue',
          conflictId: conflict.conflictId,
          conflictDigest: conflict.conflictDigest,
          valueRole: 'theirs',
          purpose: 'review',
          value: conflict.theirs,
          resolutionOptions: expect.arrayContaining([
            expect.objectContaining({ optionId: expect.any(String), kind: 'acceptOurs' }),
            expect.objectContaining({ optionId: expect.any(String), kind: 'acceptTheirs' }),
            expect.objectContaining({ optionId: expect.any(String), kind: 'acceptBase' }),
          ]),
        },
      });
    });
  });

  it('keeps conflict identity stable while redacting unsafe public diagnostics', async () => {
    await withPersistedConflictPreview(
      'detail-identity-redaction',
      async ({ sourceWb, preview }) => {
        const conflict = preview.conflicts[0];
        const detail = await sourceWb.version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'ours',
          purpose: 'review',
        });
        if (!detail.ok) throw new Error(`expected detail read success: ${detail.error.code}`);

        expect(detail.value.conflictId).toBe(conflict.conflictId);
        expect(detail.value.conflictDigest).toBe(conflict.conflictDigest);
        expect(stableOptionIds(detail.value.resolutionOptions)).toEqual(
          stableOptionIds(conflict.resolutionOptions),
        );

        const unsafePackagePath = 'xl/worksheets/sheet1.xml';
        const unsafeCellPath = 'cells/A1';
        const unsafeValue = 'sk_live_merge_secret';
        const invalid = await sourceWb.version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'ours',
          purpose: 'review',
          [`${unsafePackagePath}!${unsafeCellPath}`]: unsafeValue,
        } as any);
        expect(invalid).toMatchObject({
          ok: false,
          error: {
            diagnostics: [
              expect.objectContaining({
                message: 'The version merge review request is invalid.',
                data: expect.objectContaining({
                  redacted: true,
                  payload: expect.objectContaining({
                    operation: 'getMergeConflictDetail',
                    option: 'redacted',
                  }),
                }),
              }),
            ],
          },
        });
        expectNoDiagnosticLeaks(invalid, [unsafePackagePath, unsafeCellPath, unsafeValue]);
      },
    );
  });

  // prettier-ignore
  it('redacts stale target and access-denied artifact diagnostics', async () => {
    await withPersistedConflictPreview('public-diagnostic-redaction', async ({ sourceWb, preview, expectedTargetHead }) => {
      const conflict = preview.conflicts[0];
      const staleHead = { ...expectedTargetHead, commitId: `commit:sha256:${'9'.repeat(64)}` as any };
      const target = { targetRef: 'refs/heads/main' as any, expectedTargetHead: staleHead };
      const detail = await sourceWb.version.getMergeConflictDetail({ resultId: preview.resultId, resultDigest: preview.resultDigest, redactionPolicyDigest: preview.resultDigest, conflictId: conflict.conflictId, expectedConflictDigest: conflictDigestObject(conflict.conflictDigest), valueRole: 'theirs', purpose: 'review', ...target });
      const saved = await sourceWb.version.saveMergeResolutions({ resultId: preview.resultId, resultDigest: preview.resultDigest, redactionPolicyDigest: preview.resultDigest, resolutions: [], ...target });
      expectPublicDiagnostic(detail, 'getMergeConflictDetail', 'VERSION_MERGE_RESOLUTION_MISMATCH');
      expectPublicDiagnostic(saved, 'saveMergeResolutions', 'VERSION_MERGE_RESOLUTION_MISMATCH');
      for (const result of [detail, saved]) expectNoDiagnosticLeaks(result, [preview.base, preview.ours, preview.theirs, staleHead.commitId, preview.resultDigest.digest]);
    });
    const accessDenied = await accessDeniedPreviewArtifactResult();
    expectPublicDiagnostic(accessDenied.result, 'getMergeConflictDetail', 'VERSION_PERMISSION_DENIED', 'Version merge review is not authorized for this caller.');
    expectNoDiagnosticLeaks(accessDenied.result, accessDenied.canaries);
  });

  it('keeps formula and row/column conflict option identities stable', async () => {
    const formulaA = await readSyntheticConflictDetail(
      'stable-formula-result-a',
      formulaConflict({ result: 2, conflictIdDigit: '1' }),
    );
    const formulaB = await readSyntheticConflictDetail(
      'stable-formula-result-b',
      formulaConflict({ result: 999, conflictIdDigit: '2' }),
    );
    expectStableConflictOptions(formulaA, formulaB);

    const rowColumnA = await readSyntheticConflictDetail(
      'stable-row-column-a',
      rowColumnConflict({
        conflictIdDigit: '3',
        fields: rowColumnFields('row', 4),
      }),
    );
    const rowColumnB = await readSyntheticConflictDetail(
      'stable-row-column-b',
      rowColumnConflict({
        conflictIdDigit: '4',
        fields: [...rowColumnFields('row', 4)].reverse(),
      }),
    );
    expectStableConflictOptions(rowColumnA, rowColumnB);
  });

  it('persists saved resolutions as resolution-set and resolved-attempt artifacts', async () => {
    await withPersistedConflictPreview(
      'save-persistence',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const resolution = resolutionFor(conflict, 'acceptTheirs');

        const saved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          resolutions: [resolution],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
          throw new Error('expected saved merge resolutions to expose artifact digests');
        }
        expect(saved.value).toMatchObject({
          schemaVersion: 1,
          kind: 'mergeResolutionsSaved',
          status: 'readyToApply',
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          attemptKind: 'applyable',
          attemptPersistence: 'persisted',
          targetRef: 'refs/heads/main',
          savedResolutionCount: 1,
        });

        const graph = await provider.openGraph(
          namespaceForDocumentScope(documentScope, graphId),
          provider.accessContext,
        );
        await expect(
          graph.getObjectRecord(mergeResolutionSetArtifactRef(saved.value.resolutionSetDigest)),
        ).resolves.toMatchObject({
          preimage: {
            objectType: 'workbook.mergeResolutionSet.v1',
            payload: {
              schemaVersion: 1,
              recordKind: 'mergeResolutionSet',
              resolutions: [resolution],
            },
          },
        });
        await expect(
          graph.getObjectRecord(resolvedMergeAttemptArtifactRef(saved.value.resolvedAttemptDigest)),
        ).resolves.toMatchObject({
          preimage: {
            objectType: 'workbook.resolvedMergeAttempt.v1',
            payload: {
              schemaVersion: 1,
              recordKind: 'resolvedMergeAttempt',
              resultDigest: preview.resultDigest,
              resolutionSetDigest: saved.value.resolutionSetDigest,
              targetRef: 'refs/heads/main',
              expectedTargetHead,
            },
          },
        });
      },
    );
  });

  it('stores a matching sealed resolution payload through the provider graph', async () => {
    await withPersistedConflictPreview(
      'payload-put',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const option = conflict.resolutionOptions.find(
          (candidate) => candidate.kind === 'acceptTheirs',
        );
        if (!option) throw new Error('expected acceptTheirs option');
        const request = {
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          optionId: option.optionId,
          kind: option.kind,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          purpose: 'chooseValue',
        };

        await expect(
          sourceWb.version.putMergeResolutionPayload({
            ...request,
            value: { kind: 'value', value: 'tampered' },
          }),
        ).resolves.toMatchObject({
          ok: false,
          error: {
            diagnostics: [expect.objectContaining({ code: 'VERSION_MERGE_RESOLUTION_MISMATCH' })],
          },
        });

        const put = await sourceWb.version.putMergeResolutionPayload({
          ...request,
          value: option.value as any,
        });
        if (!put.ok) throw new Error(`expected payload put success: ${put.error.code}`);

        expect(put.value).toMatchObject({
          schemaVersion: 1,
          kind: 'sealedResolutionPayload',
          payloadId: expect.stringMatching(/^merge-payload:[0-9a-f]{64}$/),
          payloadDigest: {
            algorithm: 'sha256',
            digest: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
          storageMode: 'serverEncrypted',
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          optionId: option.optionId,
          resolutionKind: option.kind,
        });
        const graph = await provider.openGraph(
          namespaceForDocumentScope(documentScope, graphId),
          provider.accessContext,
        );
        await expect(
          graph.getObjectRecord({
            kind: 'object',
            objectType: 'workbook.reviewExtension.v1',
            digest: put.value.payloadDigest,
          }),
        ).resolves.toMatchObject({
          preimage: {
            objectType: 'workbook.reviewExtension.v1',
            payload: {
              schemaVersion: 1,
              recordKind: 'mergeResolutionPayload',
              resultId: preview.resultId,
              conflictId: conflict.conflictId,
              optionId: option.optionId,
              purpose: 'chooseValue',
            },
          },
        });
      },
    );
  });

  it('persists a verified sealed resolution payload ref in the resolution set', async () => {
    await withPersistedConflictPreview(
      'payload-save-ref',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const option = conflict.resolutionOptions.find(
          (candidate) => candidate.kind === 'acceptTheirs',
        );
        if (!option) throw new Error('expected acceptTheirs option');
        const payload = await sourceWb.version.putMergeResolutionPayload({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          optionId: option.optionId,
          kind: option.kind,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          value: option.value as any,
          purpose: 'chooseValue',
        });
        if (!payload.ok) throw new Error(`expected payload put success: ${payload.error.code}`);

        const resolution = {
          ...resolutionFor(conflict, 'acceptTheirs'),
          sealedPayloadRef: payload.value,
        };
        const saved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          resolutions: [resolution],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest) {
          throw new Error('expected sealed payload resolution save success');
        }

        const graph = await provider.openGraph(
          namespaceForDocumentScope(documentScope, graphId),
          provider.accessContext,
        );
        await expect(
          graph.getObjectRecord(mergeResolutionSetArtifactRef(saved.value.resolutionSetDigest)),
        ).resolves.toMatchObject({
          preimage: {
            objectType: 'workbook.mergeResolutionSet.v1',
            payload: {
              resolutions: [
                expect.objectContaining({
                  conflictId: conflict.conflictId,
                  optionId: option.optionId,
                  kind: 'acceptTheirs',
                  sealedPayloadRef: payload.value,
                }),
              ],
            },
          },
        });
      },
    );
  });

  it('fails closed when a saved resolution references a missing sealed payload object', async () => {
    await withPersistedConflictPreview(
      'payload-save-missing-ref',
      async ({ sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const option = conflict.resolutionOptions.find(
          (candidate) => candidate.kind === 'acceptTheirs',
        );
        if (!option) throw new Error('expected acceptTheirs option');
        const payload = await sourceWb.version.putMergeResolutionPayload({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          optionId: option.optionId,
          kind: option.kind,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          value: option.value as any,
          purpose: 'chooseValue',
        });
        if (!payload.ok) throw new Error(`expected payload put success: ${payload.error.code}`);
        const missingDigest = { algorithm: 'sha256', digest: 'f'.repeat(64) } as const;
        const resolution = {
          ...resolutionFor(conflict, 'acceptTheirs'),
          sealedPayloadRef: {
            ...payload.value,
            payloadId: `merge-payload:${missingDigest.digest}` as const,
            payloadDigest: missingDigest,
          },
        };

        const saved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          resolutions: [resolution],
        });
        expect(saved).toMatchObject({
          ok: false,
          error: {
            code: 'target_unavailable',
            diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_OBJECT' })],
          },
        });
      },
    );
  });

  it('fails closed when result id and digest do not match', async () => {
    await withPersistedConflictPreview('digest-mismatch', async ({ sourceWb, preview }) => {
      const conflict = preview.conflicts[0];
      const result = await sourceWb.version.getMergeConflictDetail({
        resultId: `merge-result:${'0'.repeat(64)}` as any,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'base',
        purpose: 'review',
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.getMergeConflictDetail',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
            }),
          ],
        },
      });
    });
  });

  it('maps redaction and schema diagnostics to blocked or invalid endpoint failures', async () => {
    const cases = [
      {
        graphId: 'redacted-identity',
        conflict: redactedStructuralConflict(),
        code: 'VERSION_REDACTION_VIOLATION',
        recoverability: 'unsupported',
      },
      {
        graphId: 'invalid-object-schema',
        conflict: rowColumnConflict({
          conflictIdDigit: '5',
          fields: [
            { key: 'axis', value: 'row' },
            { key: 'axis', value: 'column' },
          ],
        }),
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
        recoverability: 'repair',
      },
    ] as const;

    for (const item of cases) {
      await withSyntheticConflictPreview(
        item.graphId,
        item.conflict,
        async ({ sourceWb, preview }) => {
          const result = await sourceWb.version.getMergeConflictDetail({
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            redactionPolicyDigest: preview.resultDigest,
            conflictId: preview.conflicts[0].conflictId,
            expectedConflictDigest: conflictDigestObject(preview.conflicts[0].conflictDigest),
            valueRole: 'base',
            purpose: 'review',
          });
          expect(result).toMatchObject({
            ok: false,
            error: {
              code: 'target_unavailable',
              diagnostics: [
                expect.objectContaining({
                  code: item.code,
                  data: expect.objectContaining({ recoverability: item.recoverability }),
                }),
              ],
            },
          });
        },
      );
    }
  });

  it('fails closed when no provider is attached', async () => {
    const digest = { algorithm: 'sha256', digest: 'a'.repeat(64) } as const;
    const handle = await DocumentFactory.create({
      documentId: MERGE_REVIEW_DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;
    try {
      wb = await handle.workbook();
      const result = await wb.version.getMergeConflictDetail({
        resultId: `merge-result:${digest.digest}` as any,
        resultDigest: digest,
        redactionPolicyDigest: digest,
        conflictId: 'conflict:sha256:hidden',
        expectedConflictDigest: { algorithm: 'sha256', digest: 'b'.repeat(64) },
        valueRole: 'base',
        purpose: 'review',
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.getMergeConflictDetail',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_STORE_UNAVAILABLE',
            }),
          ],
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
});
