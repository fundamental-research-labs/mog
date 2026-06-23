import { fastForwardIntentInput } from './merge-apply-intent-store-test-helpers';

export function registerMergeApplyIntentStoreDigestTests(): void {
  it('computes stable result and resolved-attempt digests', async () => {
    const first = await fastForwardIntentInput();
    const second = await fastForwardIntentInput();

    expect(first.resultDigest).toEqual(second.resultDigest);
    expect(first.resolutionSetDigest).toEqual(second.resolutionSetDigest);
    expect(first.resolvedAttemptDigest).toEqual(second.resolvedAttemptDigest);
    expect(first.intentId).toBe(second.intentId);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
  });
}
