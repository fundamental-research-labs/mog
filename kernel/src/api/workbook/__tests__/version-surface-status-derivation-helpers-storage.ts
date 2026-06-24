import { jest } from '@jest/globals';

import {
  freshVersionDomainSupportManifest,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_ONE_MINUTE_MS,
  versionDomainSupportManifestOptions,
} from './version-domain-support-test-utils';
import { createSurfaceReadyVersionWithContext } from './version-surface-status-test-utils';

export function createReadOnlyProviderBackedSurfaceVersion() {
  return createSurfaceReadyVersionWithContext(
    {},
    {
      provider: {
        kind: 'memory',
        documentScope: { documentId: 'document-1' },
        capabilities: {
          readOnlyHistory: true,
          reads: {
            graphRegistry: true,
            objects: true,
            refs: true,
            commits: true,
          },
          writes: {
            commitGraphWrite: false,
            putObjects: false,
            updateRefs: false,
          },
        },
      },
      revertService: { revert: jest.fn() },
      captureMergeCommit: jest.fn(),
      mergeCommitMaterializer: { kind: 'test-materializer' },
    },
  );
}

export function createCheckoutAndRevertFeatureGateVersion() {
  return createSurfaceReadyVersionWithContext(
    {
      featureGates: {
        capabilities: {
          'versionControl.checkout': false,
          'versionControl.revert': false,
        },
      },
    },
    {
      captureMergeCommit: jest.fn(),
      mergeCommitMaterializer: { kind: 'test-materializer' },
    },
  );
}

export function createStaleManifestSurfaceVersion() {
  return createSurfaceReadyVersionWithContext(
    {},
    {
      domainSupportManifest: freshVersionDomainSupportManifest({
        generatedAt: '2026-06-20T00:00:00.000Z',
      }),
      domainSupportManifestOptions: versionDomainSupportManifestOptions({
        now: VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW,
        maxAgeMs: VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_ONE_MINUTE_MS,
      }),
      revertService: { revert: jest.fn() },
      captureMergeCommit: jest.fn(),
      mergeCommitMaterializer: { kind: 'test-materializer' },
    },
  );
}

export function createMissingSemanticReaderSurfaceVersion() {
  return createSurfaceReadyVersionWithContext(
    {},
    {
      snapshotRootByteSyncPort: { encodeDiff: jest.fn() },
      semanticMutationCapture: {
        mutationCapture: { recordMutationResult: jest.fn() },
        captureNormalCommit: jest.fn(),
        capturePendingRemoteSegment: jest.fn(),
      },
    },
  );
}
