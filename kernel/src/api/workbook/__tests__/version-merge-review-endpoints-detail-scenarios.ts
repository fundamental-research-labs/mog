import {
  accessDeniedPreviewArtifactResult,
  conflictDigestObject,
  expectNoDiagnosticLeaks,
  expectPublicDiagnostic,
  expectStableConflictOptions,
  formulaConflict,
  readSyntheticConflictDetail,
  rowColumnConflict,
  rowColumnFields,
  stableOptionIds,
  withPersistedConflictPreview,
} from './version-merge-review-endpoints-test-utils';

export function registerMergeReviewEndpointDetailScenarios(): void {
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
}
