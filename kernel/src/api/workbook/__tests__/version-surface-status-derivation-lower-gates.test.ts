import 'fake-indexeddb/auto';

import { jest } from '@jest/globals';

import {
  PROMOTED_SURFACE_CAPABILITIES,
  capabilityState,
  createAuthorizedPendingRemotePromotionSurfaceVersion,
  createMixedLowerGateEvidenceSurfaceVersion,
} from './version-surface-status-derivation-test-utils';

describe('WorkbookVersion surface status lower-gate derivation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not overclaim promoted surfaces when lower-gate evidence is mixed or lower rollout', async () => {
    const surfaceReady = createMixedLowerGateEvidenceSurfaceVersion();

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.stage).toBe('readOnly');
    expect(surface.capabilities['version:read']).toEqual({ enabled: true });
    expect(surface.capabilities['version:diff']).toEqual({ enabled: true });
    for (const capability of PROMOTED_SURFACE_CAPABILITIES) {
      expect(capabilityState(surface, capability)).toMatchObject({
        enabled: false,
        dependency: 'VC-09',
        reason: 'Promoted version surfaces require current, clean, passing lower-gate evidence.',
        retryable: true,
      });
    }
    expect(surface.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.surfaceStatus.lowerGateEvidenceBlocked',
          data: expect.objectContaining({ rolloutStage: 'ui-beta' }),
        }),
        expect.objectContaining({
          code: 'version.surfaceStatus.lowerGateEvidenceBlocked',
          data: expect.objectContaining({
            gateId: 'gate5-corpus-shadow-threshold',
            status: 'blocked',
            currentForTarget: false,
          }),
        }),
        expect.objectContaining({
          code: 'version.surfaceStatus.lowerGateEvidenceBlocked',
          data: expect.objectContaining({
            gateId: 'g7-merge-shadow-apply-proof',
            status: 'missing',
          }),
        }),
        expect.objectContaining({
          code: 'version.surfaceStatus.lowerGateEvidenceBlocked',
          data: expect.objectContaining({ repoId: 'mog', status: 'dirtyBlocked' }),
        }),
      ]),
    );
    expect(surfaceReady.commit).not.toHaveBeenCalled();
    expect(surfaceReady.planCheckout).not.toHaveBeenCalled();
    expect(surfaceReady.merge).not.toHaveBeenCalled();
    expect(surfaceReady.mergeCommit).not.toHaveBeenCalled();
    expect(surfaceReady.promotePendingRemoteSegments).not.toHaveBeenCalled();
  });

  it('reports pending remote provider state while enabling explicitly authorized promotion', async () => {
    const surfaceReady = createAuthorizedPendingRemotePromotionSurfaceVersion();

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.stage).toBe('provenance');
    expect(surface.dirty).toMatchObject({
      pendingProviderWrites: true,
      checkoutSafe: false,
      unsafeReasons: [
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWrites',
          data: { pendingRemoteSegmentCount: 2 },
        }),
      ],
    });
    expect(capabilityState(surface, 'version:remotePromote')).toEqual({ enabled: true });
    expect(surfaceReady.promotePendingRemoteSegments).not.toHaveBeenCalled();
  });
});
