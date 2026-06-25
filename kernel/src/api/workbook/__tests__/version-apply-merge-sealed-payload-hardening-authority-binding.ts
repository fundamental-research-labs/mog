import { withSealedPayloadHardeningFixture } from './version-apply-merge-sealed-payload-hardening-fixtures';
import { putForgedResolutionPayload } from './version-apply-merge-sealed-payload-test-utils';

export function registerAuthorityBindingScenario(): void {
  it('rejects sealed payload objects bound to stale authority before writes', async () => {
    await withSealedPayloadHardeningFixture(
      'reject-hardened-authority-binding',
      async (fixture) => {
        const staleAuthority = 'workspace-stale-sealed-payload';
        const authorityPayload = await putForgedResolutionPayload({
          ...fixture.forgedPayloadInput,
          extraPayload: { authority: { workspaceId: staleAuthority, principalScope: null } },
        });
        await fixture.reject({
          resolution: [
            { ...fixture.firstResolution, sealedPayloadRef: authorityPayload },
            fixture.secondResolution,
          ],
          messages: ['sealed payload object binding does not match.'],
          leakCanaries: [staleAuthority, fixture.firstOption.optionId, 'theirs'],
        });
      },
    );
  });
}
