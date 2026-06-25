import { withSealedPayloadHardeningFixture } from './version-apply-merge-sealed-payload-hardening-fixtures';

export function registerStaleConflictDigestScenario(): void {
  it('rejects stale conflict digests before writes', async () => {
    await withSealedPayloadHardeningFixture(
      'reject-hardened-stale-conflict-digest',
      async (fixture) => {
        const firstPayload = await fixture.putValidFirstPayload();
        await fixture.reject({
          resolution: [
            {
              ...fixture.firstResolution,
              expectedConflictDigest: `${fixture.firstConflict.conflictDigest}:stale`,
              sealedPayloadRef: firstPayload,
            },
            fixture.secondResolution,
          ],
          messages: ['resolution does not match the merge conflict.'],
          leakCanaries: [fixture.firstOption.optionId, 'theirs'],
          expectPayloadOperation: false,
        });
      },
    );
  });
}
