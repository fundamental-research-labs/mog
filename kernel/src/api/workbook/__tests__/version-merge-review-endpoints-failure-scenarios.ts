import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  conflictDigestObject,
  MERGE_REVIEW_DOCUMENT_ID,
  redactedStructuralConflict,
  rowColumnConflict,
  withPersistedConflictPreview,
  withSyntheticConflictPreview,
} from './version-merge-review-endpoints-test-utils';

export function registerMergeReviewEndpointFailureScenarios(): void {
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
}
