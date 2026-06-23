import 'fake-indexeddb/auto';

import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  freshVersionDomainSupportManifest,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_ONE_MINUTE_MS,
  versionDomainSupportManifestOptions,
  withVersionManifest,
} from './version-domain-support-test-utils';

const CHILD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
const REF_REVISION = { kind: 'counter', value: '2' } as const;
const REDACTED_BATCH_STATUS_ID = `sync-batch-status:sha256:${'9'.repeat(64)}`;
const REDACTED_CURSOR = 'mog-pending-remote-v1.pending.cursor-secret';

type SurfaceCapabilityForAssertion = {
  readonly enabled: boolean;
  readonly dependency?: string;
  readonly reason?: string;
  readonly retryable?: boolean;
};

function capabilityState(
  surface: { readonly capabilities: object },
  capability: string,
): SurfaceCapabilityForAssertion {
  return (surface.capabilities as Record<string, SurfaceCapabilityForAssertion>)[capability];
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {
      getAllSheetIds: jest.fn(async () => []),
      getAllTablesInSheet: jest.fn(async () => []),
      getFiltersInSheet: jest.fn(async () => []),
      namedRangeCount: jest.fn(async () => 0),
      getAllNamedRangesWire: jest.fn(async () => []),
      getHyperlinks: jest.fn(async () => []),
      getRangeSchemasForSheet: jest.fn(async () => []),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    workbookLinkScope: () => ({
      requestingDocumentId: 'document-1',
      requestingSessionId: 'session-1',
      actor: 'user-1',
      principal: { tags: ['host:trusted'] },
    }),
    ...overrides,
  } as any;
}

function createSurfaceReadyVersionWithContext(
  ctxOverrides: Record<string, unknown> = {},
  versioningOverrides: Record<string, unknown> = {},
) {
  const readHead = jest.fn(async () => ({
    status: 'success',
    head: {
      id: CHILD_COMMIT_ID,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: REF_REVISION,
    },
    diagnostics: [],
  }));
  const readRef = jest.fn(async () => ({
    status: 'success',
    ref: {
      name: 'refs/heads/main',
      commitId: CHILD_COMMIT_ID,
      revision: REF_REVISION,
    },
    diagnostics: [],
  }));
  const listCommits = jest.fn(async () => ({
    status: 'success',
    commits: [],
    readRevision: REF_REVISION,
    diagnostics: [],
  }));
  const diff = jest.fn();
  const commit = jest.fn();
  const mergeCommit = jest.fn();
  const createBranch = jest.fn();
  const readBranch = jest.fn();
  const listBranches = jest.fn();
  const fastForwardBranch = jest.fn();
  const planCheckout = jest.fn();
  const merge = jest.fn();
  const version = new WorkbookVersionImpl(
    createMockCtx({
      ...ctxOverrides,
      versioning: withVersionManifest({
        provider: {
          kind: 'memory',
          documentScope: { documentId: 'document-1' },
          capabilities: {
            reads: {
              graphRegistry: true,
              objects: true,
              refs: true,
              commits: true,
            },
          },
        },
        readService: {
          readHead,
          readRef,
          listCommits,
        },
        diffService: { diff },
        writeService: {
          commit,
          mergeCommit,
        },
        branchService: {
          createBranch,
          readBranch,
          listBranches,
          fastForwardBranch,
        },
        checkoutService: { planCheckout },
        mergeService: { merge },
        ...versioningOverrides,
      }),
    }),
  );

  return {
    version,
    commit,
    mergeCommit,
    fastForwardBranch,
    planCheckout,
    merge,
  };
}

describe('WorkbookVersion surface status derivation hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps read-only provider-backed surfaces available while disabling provider writes', async () => {
    const surfaceReady = createSurfaceReadyVersionWithContext(
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
        captureMergeCommit: jest.fn(),
        mergeCommitMaterializer: { kind: 'test-materializer' },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.stage).toBe('authoring');
    for (const capability of [
      'version:read',
      'version:diff',
      'version:checkout',
      'version:mergePreview',
    ] as const) {
      expect(surface.capabilities[capability]).toEqual({ enabled: true });
    }
    for (const capability of [
      'version:commit',
      'version:branch',
      'version:mergeApply',
    ] as const) {
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
      expect.arrayContaining([
        'version.surfaceStatus.commitUnavailable',
        'version.surfaceStatus.branchUnavailable',
        'version.surfaceStatus.mergeApplyUnavailable',
        'version.surfaceStatus.refAdminUnavailable',
      ]),
    );
    expect(surfaceReady.commit).not.toHaveBeenCalled();
    expect(surfaceReady.mergeCommit).not.toHaveBeenCalled();
    expect(surfaceReady.fastForwardBranch).not.toHaveBeenCalled();
  });

  it('honors checkout and revert feature flags without disabling sibling surfaces', async () => {
    const surfaceReady = createSurfaceReadyVersionWithContext(
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

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.capabilities['version:read']).toEqual({ enabled: true });
    expect(surface.capabilities['version:commit']).toEqual({ enabled: true });
    expect(surface.capabilities['version:mergePreview']).toEqual({ enabled: true });
    expect(surface.capabilities['version:mergeApply']).toEqual({ enabled: true });
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
      expect.arrayContaining([
        'version.surfaceStatus.checkoutCapabilityDisabled',
        'version.surfaceStatus.revertCapabilityDisabled',
      ]),
    );
    expect(surfaceReady.planCheckout).not.toHaveBeenCalled();
    expect(surfaceReady.merge).not.toHaveBeenCalled();
    expect(surfaceReady.mergeCommit).not.toHaveBeenCalled();
  });

  it('disables operation capabilities when the attached domain-support manifest is stale', async () => {
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {},
      {
        domainSupportManifest: freshVersionDomainSupportManifest({
          generatedAt: '2026-06-20T00:00:00.000Z',
        }),
        domainSupportManifestOptions: versionDomainSupportManifestOptions({
          now: VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW,
          maxAgeMs: VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_ONE_MINUTE_MS,
        }),
        captureMergeCommit: jest.fn(),
        mergeCommitMaterializer: { kind: 'test-materializer' },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    for (const capability of [
      'version:commit',
      'version:checkout',
      'version:mergePreview',
      'version:mergeApply',
    ] as const) {
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

  it('redacts malformed manifest and attached dirty-status diagnostic payloads', async () => {
    const readDirtyStatus = jest.fn(() => ({
      statusRevision: 'dirty-redacted',
      checkoutPreflightToken: 'checkout-preflight-redacted',
      hasUncommittedLocalChanges: false,
      commitEligibleChanges: false,
      unsupportedDirtyDomains: [],
      pendingProviderWrites: false,
      pendingRecalc: false,
      checkoutSafe: false,
      unsafeReasons: [
        {
          code: 'version.surfaceStatus.pendingProviderWrites',
          severity: 'warning',
          message: 'Provider writes are not settled.',
          dependency: 'VC-09',
          data: {
            cursor: REDACTED_CURSOR,
            batchStatusId: REDACTED_BATCH_STATUS_ID,
            hiddenSheetId: 'sheet-secret',
            safeCount: 2,
            nested: { raw: 'not-public' },
          },
        },
      ],
      source: 'VC-05' as const,
      diagnostics: [
        {
          code: 'version.surfaceStatus.pendingProviderWrites',
          severity: 'warning',
          message: 'Provider writes are not settled.',
          dependency: 'VC-09',
          data: {
            cursor: REDACTED_CURSOR,
            batchStatusId: REDACTED_BATCH_STATUS_ID,
            secretToken: 'token-secret',
            safeCount: 2,
          },
        },
      ],
    }));
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {},
      {
        domainSupportManifest: {
          schemaVersion: 'not-public-secret-schema',
          generatedAt: 'not-public-secret-date',
          domains: [],
        },
        domainSupportManifestOptions: versionDomainSupportManifestOptions(),
        surfaceStatusService: {
          readDirtyStatus,
        },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();
    const serialized = JSON.stringify(surface);

    expect(surface.dirty.unsafeReasons[0]?.data).toMatchObject({
      cursor: 'redacted',
      batchStatusId: 'redacted',
      hiddenSheetId: 'redacted',
      safeCount: 2,
    });
    expect(surface.dirty.diagnostics[0]?.data).toMatchObject({
      cursor: 'redacted',
      batchStatusId: 'redacted',
      secretToken: 'redacted',
      safeCount: 2,
    });
    expect(serialized).not.toContain(REDACTED_CURSOR);
    expect(serialized).not.toContain(REDACTED_BATCH_STATUS_ID);
    expect(serialized).not.toContain('sheet-secret');
    expect(serialized).not.toContain('token-secret');
    expect(serialized).not.toContain('not-public-secret-schema');
    expect(serialized).not.toContain('not-public-secret-date');
    expect(readDirtyStatus).toHaveBeenCalledTimes(1);
  });

  it('reports pending remote provider state while enabling explicitly authorized promotion', async () => {
    const promotePendingRemoteSegments = jest.fn();
    const pendingProviderDiagnostic = {
      code: 'version.surfaceStatus.pendingProviderWrites',
      severity: 'warning' as const,
      message:
        'Remote sync changes are waiting to be promoted into version history; checkout is unsafe.',
      dependency: 'VC-09' as const,
      data: { pendingRemoteSegmentCount: 2 },
    };
    const { version } = createSurfaceReadyVersionWithContext(
      {
        policySnapshot: {
          decisions: [
            { capability: 'version:remotePromote', decision: 'allowed' },
            { capability: 'version:provenance', decision: 'allowed' },
          ],
        },
      },
      {
        provenanceTruthService: {
          vc09ProvenanceTruthComplete: true,
        },
        pendingRemotePromotionService: {
          promotePendingRemoteSegments,
        },
        surfaceStatusService: {
          readDirtyStatus: () => ({
            statusRevision: 'pendingRemote:2',
            checkoutPreflightToken: 'token:pendingRemote:2',
            hasUncommittedLocalChanges: false,
            commitEligibleChanges: false,
            unsupportedDirtyDomains: [],
            pendingProviderWrites: true,
            pendingRecalc: false,
            checkoutSafe: false,
            unsafeReasons: [pendingProviderDiagnostic],
            source: 'VC-05' as const,
            diagnostics: [pendingProviderDiagnostic],
          }),
        },
      },
    );

    const surface = await version.getSurfaceStatus();

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
    expect(promotePendingRemoteSegments).not.toHaveBeenCalled();
  });
});
