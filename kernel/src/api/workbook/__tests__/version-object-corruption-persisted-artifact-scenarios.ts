import {
  mergeResolutionSetV2ArtifactRef,
  resolvedMergeAttemptArtifactRef,
} from '../../../document/version-store/merge-attempt-artifacts';
import {
  conflictDetailInput,
  corruptStoredRecord,
  expectNoLeaks,
  expectRepairDiagnostic,
  saveResolution,
  withPersistedConflictPreview,
} from './version-object-corruption-test-utils';

export function registerVersionObjectCorruptionPersistedArtifactScenarios(): void {
  it('maps corrupt persisted preview artifacts read by review endpoints to repair diagnostics', async () => {
    await withPersistedConflictPreview('review-corrupt-preview', async (fixture) => {
      corruptStoredRecord(fixture.graph, fixture.previewRecord);
      await expect(
        fixture.graph.getObjectRecord({
          kind: 'object',
          objectType: 'workbook.mergePreview.v1',
          digest: fixture.preview.resultDigest,
        }),
      ).rejects.toMatchObject({ diagnostic: { code: 'VERSION_OBJECT_CORRUPTION' } });

      const result = await fixture.version.getMergeConflictDetail(
        conflictDetailInput(fixture, { valueRole: 'theirs' }),
      );

      expectRepairDiagnostic(result, {
        target: 'workbook.version.getMergeConflictDetail',
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      });
      expectNoLeaks(result);
    });
  });

  it('maps corrupt persisted preview artifacts read by apply replay to repair diagnostics', async () => {
    await withPersistedConflictPreview('apply-corrupt-preview', async (fixture) => {
      corruptStoredRecord(fixture.graph, fixture.previewRecord);

      const result = await fixture.version.applyMerge(
        {
          resultId: fixture.preview.resultId,
          resultDigest: fixture.preview.resultDigest,
        },
        { mode: 'preview' },
      );

      expectRepairDiagnostic(result, {
        target: 'workbook.version.applyMerge',
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      });
      expectNoLeaks(result);
    });
  });

  it('maps corrupt saved resolution-set artifacts read by review endpoints to repair diagnostics', async () => {
    await withPersistedConflictPreview('review-corrupt-resolution-set', async (fixture) => {
      const saved = await saveResolution(fixture);
      const resolutionRecord = await fixture.graph.getObjectRecord(
        mergeResolutionSetV2ArtifactRef(saved.resolutionSetDigest),
      );
      corruptStoredRecord(fixture.graph, resolutionRecord);

      const result = await fixture.version.getMergeConflictDetail(
        conflictDetailInput(fixture, {
          valueRole: 'resolved',
          resolutionSetDigest: saved.resolutionSetDigest,
        }),
      );

      expectRepairDiagnostic(result, {
        target: 'workbook.version.getMergeConflictDetail',
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      });
      expectNoLeaks(result);
    });
  });

  it('maps corrupt resolved-attempt artifacts read by review endpoints to repair diagnostics', async () => {
    await withPersistedConflictPreview('review-corrupt-resolved-attempt', async (fixture) => {
      const saved = await saveResolution(fixture);
      if (!saved.resolvedAttemptDigest) throw new Error('expected resolved attempt digest');
      const attemptRecord = await fixture.graph.getObjectRecord(
        resolvedMergeAttemptArtifactRef(saved.resolvedAttemptDigest),
      );
      corruptStoredRecord(fixture.graph, attemptRecord);

      const result = await fixture.version.getMergeConflictDetail(
        conflictDetailInput(fixture, {
          valueRole: 'resolved',
          resolvedAttemptDigest: saved.resolvedAttemptDigest,
        }),
      );

      expectRepairDiagnostic(result, {
        target: 'workbook.version.getMergeConflictDetail',
        code: 'VERSION_INVALID_COMMIT_PAYLOAD',
      });
      expectNoLeaks(result);
    });
  });
}
