import {
  captureInput,
  expectCaptureSuccess,
} from './semantic-mutation-capture-formula-test-helpers';
import {
  createCanonicalFormulaIdentityCapture,
  expectCanonicalFormulaIdentityPayload,
  expectFormulaIdentityStateReaderCalls,
  recordCanonicalFormulaIdentityMutation,
} from './semantic-mutation-capture-formula-identity-helpers';

export function describeCanonicalFormulaIdentityScenarios(): void {
  it('stores canonical formula identity and result evidence without display-only refs', async () => {
    const harness = createCanonicalFormulaIdentityCapture();

    await recordCanonicalFormulaIdentityMutation(harness.capture);

    const captured = expectCaptureSuccess(
      await harness.capture.captureNormalCommit(captureInput()),
    );
    const payload = captured.input.semanticChangeSetRecord.preimage.payload as any;
    expectFormulaIdentityStateReaderCalls(harness);
    expectCanonicalFormulaIdentityPayload(payload, harness);
  });
}
