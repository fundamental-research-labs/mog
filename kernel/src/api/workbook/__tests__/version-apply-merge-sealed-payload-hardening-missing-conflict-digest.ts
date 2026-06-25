import { withSealedPayloadHardeningFixture } from './version-apply-merge-sealed-payload-hardening-fixtures';
import { putForgedResolutionPayload } from './version-apply-merge-sealed-payload-test-utils';

export function registerMissingConflictDigestScenario(): void {
  it('rejects sealed payload objects missing conflict digests before writes', async () => {
    await withSealedPayloadHardeningFixture(
      'reject-hardened-missing-conflict-digest',
      async (fixture) => {
        const missingDigestPayload = await putForgedResolutionPayload({
          ...fixture.forgedPayloadInput,
          omitPayloadKeys: ['conflictDigest'],
        });
        await fixture.reject({
          resolution: [
            { ...fixture.firstResolution, sealedPayloadRef: missingDigestPayload },
            fixture.secondResolution,
          ],
          messages: ['sealed payload object is invalid.'],
          leakCanaries: [fixture.firstOption.optionId, 'theirs'],
        });
      },
    );
  });
}
