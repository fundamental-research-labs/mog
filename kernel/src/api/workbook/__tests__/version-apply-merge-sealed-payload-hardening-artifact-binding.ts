import { withSealedPayloadHardeningFixture } from './version-apply-merge-sealed-payload-hardening-fixtures';
import {
  putForgedResolutionPayload,
  putWrongPreviewArtifact,
} from './version-apply-merge-sealed-payload-test-utils';

export function registerWrongArtifactBindingScenario(): void {
  it('rejects sealed payload refs bound to a different preview artifact before writes', async () => {
    await withSealedPayloadHardeningFixture('reject-hardened-artifact-binding', async (fixture) => {
      const wrongPreviewDigest = await putWrongPreviewArtifact({
        provider: fixture.provider,
        graphId: fixture.graphId,
        documentScope: fixture.documentScope,
        preview: fixture.preview,
      });
      const wrongArtifactPayload = await putForgedResolutionPayload({
        ...fixture.forgedPayloadInput,
        dependencyResultDigest: wrongPreviewDigest,
      });
      await fixture.reject({
        resolution: [
          { ...fixture.firstResolution, sealedPayloadRef: wrongArtifactPayload },
          fixture.secondResolution,
        ],
        messages: ['sealed payload artifact binding does not match.'],
        leakCanaries: [wrongPreviewDigest.digest, fixture.firstOption.optionId, 'theirs'],
      });
    });
  });
}
