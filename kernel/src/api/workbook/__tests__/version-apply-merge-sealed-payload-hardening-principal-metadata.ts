import { withSealedPayloadHardeningFixture } from './version-apply-merge-sealed-payload-hardening-fixtures';
import { putForgedResolutionPayload } from './version-apply-merge-sealed-payload-test-utils';

export function registerPrincipalMetadataScenario(): void {
  it('rejects sealed payload objects with principal metadata before writes', async () => {
    await withSealedPayloadHardeningFixture(
      'reject-hardened-principal-metadata',
      async (fixture) => {
        const principalCanary = 'principal-secret-sealed-payload';
        const principalPayload = await putForgedResolutionPayload({
          ...fixture.forgedPayloadInput,
          extraPayload: { principalScope: principalCanary },
        });
        await fixture.reject({
          resolution: [
            { ...fixture.firstResolution, sealedPayloadRef: principalPayload },
            fixture.secondResolution,
          ],
          messages: ['sealed payload object is invalid.'],
          leakCanaries: [principalCanary, fixture.firstOption.optionId, 'theirs'],
        });
      },
    );
  });
}
