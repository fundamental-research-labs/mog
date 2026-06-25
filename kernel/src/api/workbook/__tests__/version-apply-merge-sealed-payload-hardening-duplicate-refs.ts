import { withSealedPayloadHardeningFixture } from './version-apply-merge-sealed-payload-hardening-fixtures';

export function registerDuplicateRefsScenario(): void {
  it('rejects duplicate sealed payload refs before writes', async () => {
    await withSealedPayloadHardeningFixture('reject-hardened-duplicate-refs', async (fixture) => {
      const firstPayload = await fixture.putValidFirstPayload();
      await fixture.reject({
        resolution: [
          { ...fixture.firstResolution, sealedPayloadRef: firstPayload },
          { ...fixture.secondResolution, sealedPayloadRef: firstPayload },
        ],
        messages: ['duplicate sealed payload ref supplied.'],
        leakCanaries: [fixture.firstOption.optionId, 'theirs'],
      });
    });
  });
}
