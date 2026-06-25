import {
  captureInput,
  createTestSemanticMutationCapture,
  expectCaptureSuccess,
} from './semantic-mutation-capture-test-helpers';
import {
  expectedSheetStructuralLifecycleMutationSegments,
  expectedSheetStructuralLifecycleSemanticPayload,
} from './semantic-mutation-capture-sheets-structural-lifecycle-expectations';
import { recordSheetStructuralLifecycleMutations } from './semantic-mutation-capture-sheets-structural-lifecycle-mutations';

export function describeSheetStructuralLifecycleScenarios(): void {
  it('captures sheet create, remove, copy, and move structural changes', async () => {
    const capture = createTestSemanticMutationCapture();

    recordSheetStructuralLifecycleMutations(capture);

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      source: { kind: 'rustSemanticDiff' },
      reviewChanges: expectedSheetStructuralLifecycleSemanticPayload().changes,
    });
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual(
      expectedSheetStructuralLifecycleMutationSegments(),
    );
  });
}
