import 'fake-indexeddb/auto';

import { jest } from '@jest/globals';

import {
  FEATURE_GATE_DIAGNOSTIC_CODES,
  FEATURE_GATE_SIBLING_CAPABILITIES,
  MANIFEST_OPERATION_CAPABILITIES,
  PROVIDER_WRITE_CAPABILITIES,
  READ_ONLY_PROVIDER_BACKED_CAPABILITIES,
  READ_ONLY_PROVIDER_DIAGNOSTIC_CODES,
  capabilityState,
  createCheckoutAndRevertFeatureGateVersion,
  createMissingSemanticReaderSurfaceVersion,
  createReadOnlyProviderBackedSurfaceVersion,
  createStaleManifestSurfaceVersion,
} from './version-surface-status-derivation-test-utils';

describe('WorkbookVersion surface status derivation hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('storage and feature gates', () => {
    it('keeps read-only provider-backed surfaces available while disabling provider writes', async () => {
      const surfaceReady = createReadOnlyProviderBackedSurfaceVersion();

      const surface = await surfaceReady.version.getSurfaceStatus();

      expect(surface.stage).toBe('authoring');
      for (const capability of READ_ONLY_PROVIDER_BACKED_CAPABILITIES) {
        expect(surface.capabilities[capability]).toEqual({ enabled: true });
      }
      for (const capability of PROVIDER_WRITE_CAPABILITIES) {
        expect(surface.capabilities[capability]).toMatchObject({
          enabled: false,
          dependency: 'storage',
          retryable: false,
        });
      }
      expect(capabilityState(surface, 'version:refAdmin')).toMatchObject({
        enabled: false,
        dependency: 'storage',
        retryable: false,
      });
      expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining([...READ_ONLY_PROVIDER_DIAGNOSTIC_CODES]),
      );
      expect(surfaceReady.commit).not.toHaveBeenCalled();
      expect(surfaceReady.mergeCommit).not.toHaveBeenCalled();
      expect(surfaceReady.fastForwardBranch).not.toHaveBeenCalled();
    });

    it('honors checkout and revert feature flags without disabling sibling surfaces', async () => {
      const surfaceReady = createCheckoutAndRevertFeatureGateVersion();

      const surface = await surfaceReady.version.getSurfaceStatus();

      for (const capability of FEATURE_GATE_SIBLING_CAPABILITIES) {
        expect(surface.capabilities[capability]).toEqual({ enabled: true });
      }
      expect(surface.capabilities['version:checkout']).toMatchObject({
        enabled: false,
        dependency: 'featureGate',
        reason: 'The versionControl.checkout feature gate is disabled.',
        retryable: false,
      });
      expect(capabilityState(surface, 'version:revert')).toMatchObject({
        enabled: false,
        dependency: 'featureGate',
        reason: 'The versionControl.revert feature gate is disabled.',
        retryable: false,
      });
      expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining([...FEATURE_GATE_DIAGNOSTIC_CODES]),
      );
      expect(surfaceReady.planCheckout).not.toHaveBeenCalled();
      expect(surfaceReady.merge).not.toHaveBeenCalled();
      expect(surfaceReady.mergeCommit).not.toHaveBeenCalled();
    });

    it('disables provider-backed commits when semantic capture has no Rust reader', async () => {
      const surfaceReady = createMissingSemanticReaderSurfaceVersion();

      const surface = await surfaceReady.version.getSurfaceStatus();

      expect(capabilityState(surface, 'version:commit')).toMatchObject({
        enabled: false,
        dependency: 'storage',
        reason: 'Normal provider-backed commits require a Rust semantic state reader.',
        retryable: true,
      });
      expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'version.surfaceStatus.semanticStateReaderUnavailable',
      );
      expect(surfaceReady.commit).not.toHaveBeenCalled();
    });
  });

  describe('domain support manifests', () => {
    it('disables operation capabilities when the attached domain-support manifest is stale', async () => {
      const surfaceReady = createStaleManifestSurfaceVersion();

      const surface = await surfaceReady.version.getSurfaceStatus();

      for (const capability of MANIFEST_OPERATION_CAPABILITIES) {
        expect(surface.capabilities[capability]).toMatchObject({
          enabled: false,
          dependency: 'storage',
          reason:
            'The attached document domain support manifest is stale for this version capability.',
          retryable: true,
        });
      }
      const manifestDiagnostics = surface.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'version.surfaceStatus.domainSupportManifestDiagnostic',
      );
      expect(manifestDiagnostics.length).toBeGreaterThan(0);
      expect(manifestDiagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              'The document domain support manifest is invalid for durable version operations.',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({
                diagnosticCode: 'manifest-stale',
              }),
            }),
          }),
        ]),
      );
      expect(surfaceReady.commit).not.toHaveBeenCalled();
      expect(surfaceReady.planCheckout).not.toHaveBeenCalled();
      expect(surfaceReady.merge).not.toHaveBeenCalled();
      expect(surfaceReady.mergeCommit).not.toHaveBeenCalled();
    });
  });
});
