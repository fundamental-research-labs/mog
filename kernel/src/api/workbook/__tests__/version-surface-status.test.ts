import 'fake-indexeddb/auto';

import { jest } from '@jest/globals';

import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import { WorkbookVersionImpl } from '../version';
import { withVersionManifest } from './version-domain-support-test-utils';

const CHILD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
const MOVED_COMMIT_ID = `commit:sha256:${'3'.repeat(64)}`;
const REF_REVISION = { kind: 'counter', value: '2' } as const;

const SURFACE_CAPABILITY_KEYS = [
  'version:read',
  'version:diff',
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:mergePreview',
  'version:mergeApply',
  'version:refAdmin',
  'version:revert',
  'version:provenance',
  'version:remotePromote',
] as const;

const HOST_DENIAL_SPLIT_CAPABILITIES = [
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:revert',
  'version:provenance',
  'version:mergeApply',
] as const;

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

function createCompleteProposalService(overrides: Record<string, unknown> = {}) {
  return {
    createProposal: jest.fn(),
    startProposalWorkspace: jest.fn(),
    getProposalWorkspace: jest.fn(),
    disposeProposalWorkspace: jest.fn(),
    commitProposalWorkspace: jest.fn(),
    failProposal: jest.fn(),
    getProposal: jest.fn(),
    listProposals: jest.fn(),
    markProposalVerified: jest.fn(),
    openProposalReview: jest.fn(),
    acceptProposal: jest.fn(),
    rejectProposal: jest.fn(),
    supersedeProposal: jest.fn(),
    proposalWorkspaceLifecycleAvailable: true,
    ...overrides,
  };
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {},
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

function createSurfaceReadyVersion() {
  return createSurfaceReadyVersionWithContext();
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
      versioning: {
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
      },
    }),
  );

  return {
    version,
    readHead,
    readRef,
    listCommits,
    diff,
    commit,
    mergeCommit,
    createBranch,
    readBranch,
    listBranches,
    fastForwardBranch,
    planCheckout,
    merge,
  };
}

function createSplitCapabilityReadyVersion(ctxOverrides: Record<string, unknown> = {}) {
  return createSurfaceReadyVersionWithContext(ctxOverrides, {
    reviewService: {
      listReviews: jest.fn(),
      getReview: jest.fn(),
      getReviewDiff: jest.fn(),
      createReview: jest.fn(),
      appendReviewDecision: jest.fn(),
      updateReviewStatus: jest.fn(),
    },
    proposalService: createCompleteProposalService(),
    captureMergeCommit: jest.fn(),
    mergeCommitMaterializer: { kind: 'test-materializer' },
    provenanceTruthService: {
      vc09ProvenanceTruthComplete: true,
    },
  });
}

describe('WorkbookVersion surface status', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  it('returns off surface status with disabled capabilities when no services are attached', async () => {
    const version = new WorkbookVersionImpl(createMockCtx());

    const surface = await version.getSurfaceStatus();

    expect(surface.schemaVersion).toBe(1);
    expect(surface.documentId).toBe('document-1');
    expect(surface.stage).toBe('off');
    expect(surface.featureGateEnabled).toBe(true);
    expect(surface.storage).toMatchObject({
      ready: false,
      backend: 'unknown',
    });
    expect(surface.dirty).toMatchObject({
      source: 'VC-05',
      checkoutSafe: false,
      checkoutPreflightToken: 'VC-05-checkout-preflight-unavailable',
    });
    expect(Object.keys(surface.capabilities).sort()).toEqual([...SURFACE_CAPABILITY_KEYS].sort());
    expect(Object.values(surface.capabilities).every((capability) => !capability.enabled)).toBe(
      true,
    );
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.surfaceStatus.featureGateDefaultEnabled',
        'version.surfaceStatus.storageUnavailable',
        'version.surfaceStatus.readUnavailable',
        'version.surfaceStatus.dirtyTokenUnavailable',
      ]),
    );
  });

  it('reports ready storage and a main ref head for a blank IndexedDB-backed document', async () => {
    const handle = await DocumentFactory.create({
      documentId: 'vc-shell-default-versioning-blank',
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      const surface = await wb.version.getSurfaceStatus();
      const diagnosticCodes = surface.diagnostics.map((diagnostic) => diagnostic.code);

      expect(surface.storage).toMatchObject({
        ready: true,
        backend: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      });
      for (const code of [
        'version.surfaceStatus.storageUnavailable',
        'version.surfaceStatus.readUnavailable',
        'version.surfaceStatus.currentReadFailed',
      ]) {
        expect(diagnosticCodes).not.toContain(code);
      }

      const head = await wb.version.getHead();
      expect(head).toMatchObject({
        ok: true,
        value: {
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: expect.anything(),
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

  it('enables merge preview but not merge apply when no merge materializer is attached', async () => {
    const surfaceReady = createSurfaceReadyVersion();

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.stage).toBe('authoring');
    expect(surface.storage).toMatchObject({
      ready: true,
      backend: 'memory',
    });
    expect(surface.current).toMatchObject({
      headCommitId: CHILD_COMMIT_ID,
      branchName: 'main',
      currentRefHeadId: CHILD_COMMIT_ID,
      detached: false,
      stale: false,
    });
    for (const capability of [
      'version:read',
      'version:diff',
      'version:commit',
      'version:branch',
      'version:checkout',
      'version:mergePreview',
    ] as const) {
      expect(surface.capabilities[capability]).toEqual({ enabled: true });
    }
    expect(capabilityState(surface, 'version:refAdmin')).toEqual({ enabled: true });
    expect(surface.capabilities['version:mergeApply']).toMatchObject({
      enabled: false,
      dependency: 'VC-07',
    });
    expect(surface.dirty.checkoutSafe).toBe(false);
    expect(surfaceReady.readHead).toHaveBeenCalledTimes(1);
    expect(surfaceReady.readRef).toHaveBeenCalledWith('refs/heads/main');
    expect(surfaceReady.listCommits).not.toHaveBeenCalled();
    expect(surfaceReady.commit).not.toHaveBeenCalled();
    expect(surfaceReady.mergeCommit).not.toHaveBeenCalled();
    expect(surfaceReady.createBranch).not.toHaveBeenCalled();
    expect(surfaceReady.readBranch).not.toHaveBeenCalled();
    expect(surfaceReady.listBranches).not.toHaveBeenCalled();
    expect(surfaceReady.fastForwardBranch).not.toHaveBeenCalled();
    expect(surfaceReady.planCheckout).not.toHaveBeenCalled();
    expect(surfaceReady.merge).not.toHaveBeenCalled();
    expect(surfaceReady.diff).not.toHaveBeenCalled();
  });

  it('enables merge apply when the attached write service has a merge materializer', async () => {
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {},
      {
        captureMergeCommit: jest.fn(),
        mergeCommitMaterializer: { kind: 'test-materializer' },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.stage).toBe('merge');
    expect(surface.capabilities['version:mergePreview']).toEqual({ enabled: true });
    expect(surface.capabilities['version:mergeApply']).toEqual({ enabled: true });
  });

  it('enables review read and write when matching review service methods are attached', async () => {
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {},
      {
        reviewService: {
          listReviews: jest.fn(),
          getReview: jest.fn(),
          getReviewDiff: jest.fn(),
          createReview: jest.fn(),
          appendReviewDecision: jest.fn(),
          updateReviewStatus: jest.fn(),
        },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.capabilities['version:reviewRead']).toEqual({ enabled: true });
    expect(surface.capabilities['version:reviewWrite']).toEqual({ enabled: true });
  });

  it('projects review read and write capabilities independently', async () => {
    const readOnly = createSurfaceReadyVersionWithContext(
      {},
      {
        reviewService: {
          listReviews: jest.fn(),
          getReview: jest.fn(),
          getReviewDiff: jest.fn(),
        },
      },
    );
    const writeOnly = createSurfaceReadyVersionWithContext(
      {},
      {
        reviewService: {
          createReview: jest.fn(),
          appendReviewDecision: jest.fn(),
          updateReviewStatus: jest.fn(),
        },
      },
    );

    const readSurface = await readOnly.version.getSurfaceStatus();
    const writeSurface = await writeOnly.version.getSurfaceStatus();

    expect(readSurface.capabilities['version:reviewRead']).toEqual({ enabled: true });
    expect(readSurface.capabilities['version:reviewWrite']).toMatchObject({
      enabled: false,
      dependency: 'storage',
      retryable: true,
    });
    expect(writeSurface.capabilities['version:reviewRead']).toMatchObject({
      enabled: false,
      dependency: 'storage',
      retryable: true,
    });
    expect(writeSurface.capabilities['version:reviewWrite']).toEqual({ enabled: true });
  });

  it('disables only merge capabilities when the versionControl.merge feature gate is disabled', async () => {
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {
        featureGates: { capabilities: { 'versionControl.merge': false } },
      },
      {
        captureMergeCommit: jest.fn(),
        mergeCommitMaterializer: { kind: 'test-materializer' },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.stage).toBe('authoring');
    expect(surface.capabilities['version:read']).toEqual({ enabled: true });
    expect(surface.capabilities['version:commit']).toEqual({ enabled: true });
    expect(surface.capabilities['version:mergePreview']).toMatchObject({
      enabled: false,
      dependency: 'featureGate',
      retryable: false,
    });
    expect(surface.capabilities['version:mergeApply']).toMatchObject({
      enabled: false,
      dependency: 'featureGate',
      retryable: false,
    });
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'version.surfaceStatus.mergeCapabilityDisabled',
    );
    expect(surfaceReady.merge).not.toHaveBeenCalled();
    expect(surfaceReady.mergeCommit).not.toHaveBeenCalled();
  });

  it('reports runtime kill switch disabled merge capabilities without disabling reads', async () => {
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {},
      {
        versionControlMergeKillSwitch: true,
        captureMergeCommit: jest.fn(),
        mergeCommitMaterializer: { kind: 'test-materializer' },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.stage).toBe('authoring');
    expect(surface.featureGateEnabled).toBe(true);
    expect(surface.capabilities['version:read']).toEqual({ enabled: true });
    expect(surface.capabilities['version:commit']).toEqual({ enabled: true });
    expect(surface.capabilities['version:mergePreview']).toMatchObject({
      enabled: false,
      dependency: 'featureGate',
      reason: 'The versionControl.merge runtime kill switch is active.',
      retryable: false,
    });
    expect(surface.capabilities['version:mergeApply']).toMatchObject({
      enabled: false,
      dependency: 'featureGate',
      reason: 'The versionControl.merge runtime kill switch is active.',
      retryable: false,
    });
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'version.surfaceStatus.mergeKillSwitchActive',
    );
    expect(surfaceReady.readHead).toHaveBeenCalledTimes(1);
    expect(surfaceReady.merge).not.toHaveBeenCalled();
    expect(surfaceReady.mergeCommit).not.toHaveBeenCalled();
  });

  it('uses attached real dirty status without invoking checkout planning', async () => {
    const dirtyStatus = {
      statusRevision: 'dirty-revision-1',
      checkoutPreflightToken: 'checkout-preflight-token-1',
      hasUncommittedLocalChanges: false,
      commitEligibleChanges: false,
      unsupportedDirtyDomains: [],
      pendingProviderWrites: false,
      pendingRecalc: false,
      checkoutSafe: true,
      unsafeReasons: [],
      source: 'VC-05' as const,
      diagnostics: [],
    };
    const readDirtyStatus = jest.fn(() => dirtyStatus);
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {},
      {
        surfaceStatusService: {
          readDirtyStatus,
        },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.dirty).toEqual(dirtyStatus);
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'version.surfaceStatus.dirtyTokenUnavailable',
    );
    expect(readDirtyStatus).toHaveBeenCalledTimes(1);
    expect(surfaceReady.planCheckout).not.toHaveBeenCalled();
  });

  it('reports stale active checkout-session status from current ref head', async () => {
    const readDirtyStatus = jest.fn(() => ({
      statusRevision: 'dirty-revision-clean',
      checkoutPreflightToken: 'checkout-preflight-token-clean',
      hasUncommittedLocalChanges: false,
      commitEligibleChanges: false,
      unsupportedDirtyDomains: [],
      pendingProviderWrites: false,
      pendingRecalc: false,
      checkoutSafe: true,
      unsafeReasons: [],
      source: 'VC-05' as const,
      diagnostics: [],
    }));
    const readActiveCheckoutSession = jest.fn(() => ({
      checkedOutCommitId: CHILD_COMMIT_ID,
      branchName: 'main',
      refHeadAtMaterialization: CHILD_COMMIT_ID,
      detached: false,
    }));
    const readHeadShouldNotRun = jest.fn();
    const sessionReadRef = jest.fn(async () => ({
      status: 'success',
      ref: {
        name: 'refs/heads/main',
        commitId: MOVED_COMMIT_ID,
        revision: REF_REVISION,
      },
      diagnostics: [],
    }));
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {},
      {
        surfaceStatusService: {
          readDirtyStatus,
          readActiveCheckoutSession,
        },
        readService: {
          readHead: readHeadShouldNotRun,
          readRef: sessionReadRef,
          listCommits: jest.fn(),
        },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.current).toMatchObject({
      headCommitId: CHILD_COMMIT_ID,
      checkedOutCommitId: CHILD_COMMIT_ID,
      branchName: 'main',
      refHeadAtMaterialization: CHILD_COMMIT_ID,
      currentRefHeadId: MOVED_COMMIT_ID,
      detached: false,
      stale: true,
      staleReason: 'refMoved',
    });
    expect(readActiveCheckoutSession).toHaveBeenCalledTimes(1);
    expect(readHeadShouldNotRun).not.toHaveBeenCalled();
    expect(sessionReadRef).toHaveBeenCalledWith('refs/heads/main');
    expect(surfaceReady.planCheckout).not.toHaveBeenCalled();
  });

  it('falls back to conservative dirty status when the adapter payload is invalid', async () => {
    const readDirtyStatus = jest.fn(() => ({
      checkoutSafe: true,
    }));
    const { version } = createSurfaceReadyVersionWithContext(
      {},
      {
        surfaceStatusService: {
          readDirtyStatus,
        },
      },
    );

    const surface = await version.getSurfaceStatus();

    expect(surface.dirty).toMatchObject({
      source: 'VC-05',
      checkoutSafe: false,
      checkoutPreflightToken: 'VC-05-checkout-preflight-unavailable',
    });
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.surfaceStatus.dirtyStatusInvalid',
        'version.surfaceStatus.dirtyTokenUnavailable',
      ]),
    );
  });

  it('keeps proposal and revert disabled, and provenance unavailable until VC09 truth is attached', async () => {
    const { version } = createSurfaceReadyVersion();

    const surface = await version.getSurfaceStatus();

    expect(surface.capabilities['version:proposal']).toMatchObject({
      enabled: false,
      dependency: 'VC-05',
      retryable: false,
    });
    expect(surface.capabilities['version:revert']).toMatchObject({
      enabled: false,
      dependency: 'upstreamRevertContract',
      retryable: false,
    });
    expect(surface.capabilities['version:provenance']).toMatchObject({
      enabled: false,
      dependency: 'VC-09',
      retryable: true,
    });
  });

  it('enables proposal status only when a complete workflow service is attached', async () => {
    const partial = createSurfaceReadyVersionWithContext(
      {},
      {
        proposalService: {
          createProposal: jest.fn(),
        },
      },
    );
    const completeProposalService = createCompleteProposalService();
    const complete = createSurfaceReadyVersionWithContext(
      {},
      {
        proposalService: completeProposalService,
      },
    );
    const lifecycleDisabled = createSurfaceReadyVersionWithContext(
      {},
      {
        proposalService: createCompleteProposalService({
          proposalWorkspaceLifecycleAvailable: false,
        }),
      },
    );

    const partialSurface = await partial.version.getSurfaceStatus();
    const completeSurface = await complete.version.getSurfaceStatus();
    const lifecycleDisabledSurface = await lifecycleDisabled.version.getSurfaceStatus();

    expect(partialSurface.capabilities['version:proposal']).toMatchObject({
      enabled: false,
      dependency: 'VC-05',
      retryable: false,
    });
    expect(completeSurface.stage).toBe('proposal');
    expect(completeSurface.capabilities['version:proposal']).toEqual({ enabled: true });
    expect(lifecycleDisabledSurface.capabilities['version:proposal']).toMatchObject({
      enabled: false,
      dependency: 'VC-05',
      retryable: false,
    });
    for (const method of Object.values(completeProposalService)) {
      if (typeof method === 'function') expect(method).not.toHaveBeenCalled();
    }
  });

  it('keeps ref admin separate from branch creation and default-denied without admin services', async () => {
    const createBranch = jest.fn();
    const { version } = createSurfaceReadyVersionWithContext(
      {},
      {
        branchService: {
          createBranch,
        },
      },
    );

    const surface = await version.getSurfaceStatus();

    expect(surface.capabilities['version:branch']).toEqual({ enabled: true });
    expect(capabilityState(surface, 'version:refAdmin')).toMatchObject({
      enabled: false,
      dependency: 'VC-05',
      retryable: true,
    });
    expect(createBranch).not.toHaveBeenCalled();
  });

  it('reports host capability denial for ref admin independently of branch creation', async () => {
    const { version } = createSurfaceReadyVersionWithContext({
      policySnapshot: {
        decisions: [{ capability: 'version:refAdmin', decision: 'denied' }],
      },
    });

    const surface = await version.getSurfaceStatus();

    expect(surface.capabilities['version:branch']).toEqual({ enabled: true });
    expect(capabilityState(surface, 'version:refAdmin')).toMatchObject({
      enabled: false,
      dependency: 'hostCapability',
      retryable: false,
    });
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'version.surfaceStatus.hostCapabilityDenied',
    );
  });

  it('does not enable provenance when only pending remote promotion service is attached', async () => {
    const promotePendingRemoteSegments = jest.fn();
    const { version } = createSurfaceReadyVersionWithContext(
      {},
      {
        pendingRemotePromotionService: {
          promotePendingRemoteSegments,
        },
      },
    );

    const surface = await version.getSurfaceStatus();

    expect(surface.stage).toBe('authoring');
    expect(surface.capabilities['version:provenance']).toMatchObject({
      enabled: false,
      dependency: 'VC-09',
      retryable: true,
      reason:
        'Complete VC-09 provenance truth is not attached; broad mutation admission and pending remote promotion plumbing are insufficient.',
    });
    expect(promotePendingRemoteSegments).not.toHaveBeenCalled();
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'version.surfaceStatus.provenanceUnavailable',
    );
  });

  it('enables provenance only when status reports complete VC09 truth', async () => {
    const { version } = createSurfaceReadyVersionWithContext(
      {},
      {
        provenanceTruthService: {
          vc09ProvenanceTruthComplete: true,
        },
      },
    );

    const surface = await version.getSurfaceStatus();

    expect(surface.stage).toBe('provenance');
    expect(surface.capabilities['version:provenance']).toEqual({ enabled: true });
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'version.surfaceStatus.provenanceUnavailable',
    );
  });

  it('derives review, proposal, revert, provenance, and merge apply capabilities independently', async () => {
    const { version } = createSplitCapabilityReadyVersion();

    const surface = await version.getSurfaceStatus();

    for (const capability of [
      'version:reviewRead',
      'version:reviewWrite',
      'version:proposal',
      'version:provenance',
      'version:mergeApply',
    ] as const) {
      expect(capabilityState(surface, capability)).toEqual({ enabled: true });
    }
    expect(surface.capabilities['version:mergePreview']).toEqual({ enabled: true });
    expect(capabilityState(surface, 'version:revert')).toMatchObject({
      enabled: false,
      dependency: 'upstreamRevertContract',
      retryable: false,
    });
    expect(surface.stage).toBe('provenance');
  });

  it.each(HOST_DENIAL_SPLIT_CAPABILITIES)(
    'redacts host-denied disabled reason for %s without collapsing sibling capabilities',
    async (deniedCapability) => {
      const { version } = createSplitCapabilityReadyVersion({
        policySnapshot: {
          decisions: [{ capability: deniedCapability, decision: 'denied' }],
        },
      });

      const surface = await version.getSurfaceStatus();
      const disabled = capabilityState(surface, deniedCapability);

      expect(disabled).toMatchObject({
        enabled: false,
        dependency: 'hostCapability',
        reason: 'Host policy denies this version capability.',
        retryable: false,
      });
      expect(disabled.reason).not.toContain('version:');
      expect(disabled.reason).not.toContain(deniedCapability);

      const diagnostic = surface.diagnostics.find(
        (entry) =>
          entry.code === 'version.surfaceStatus.hostCapabilityDenied' &&
          entry.data?.capability === deniedCapability,
      );
      expect(diagnostic).toMatchObject({
        dependency: 'hostCapability',
        message: 'Host policy denies this version capability.',
        data: { capability: deniedCapability },
      });

      for (const capability of HOST_DENIAL_SPLIT_CAPABILITIES) {
        if (capability === deniedCapability) continue;
        if (capability === 'version:revert') {
          expect(capabilityState(surface, capability)).toMatchObject({
            enabled: false,
            dependency: 'upstreamRevertContract',
            retryable: false,
          });
          continue;
        }
        expect(capabilityState(surface, capability)).toEqual({ enabled: true });
      }
      expect(surface.capabilities['version:mergePreview']).toEqual({ enabled: true });
    },
  );

  it('keeps read surfaces available and disables mutating capabilities when editing is false', async () => {
    const { version } = createSurfaceReadyVersionWithContext({
      featureGates: { editing: false },
    });

    const surface = await version.getSurfaceStatus();

    expect(surface.stage).toBe('readOnly');
    expect(surface.capabilities['version:read']).toEqual({ enabled: true });
    expect(surface.capabilities['version:diff']).toEqual({ enabled: true });
    expect(surface.capabilities['version:mergePreview']).toEqual({ enabled: true });
    for (const capability of [
      'version:commit',
      'version:branch',
      'version:checkout',
      'version:reviewWrite',
      'version:proposal',
      'version:mergeApply',
      'version:revert',
    ] as const) {
      expect(surface.capabilities[capability]).toMatchObject({
        enabled: false,
        dependency: 'featureGate',
        retryable: false,
      });
    }
    expect(capabilityState(surface, 'version:refAdmin')).toMatchObject({
      enabled: false,
      dependency: 'featureGate',
      retryable: false,
    });
    expect(capabilityState(surface, 'version:remotePromote')).toMatchObject({
      enabled: false,
      dependency: 'featureGate',
      retryable: false,
    });
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'version.surfaceStatus.editingDisabled',
    );
  });

  it('reports host capability denial when an attached policy snapshot denies a version grant', async () => {
    const { version } = createSurfaceReadyVersionWithContext({
      policySnapshot: {
        decisions: [{ capability: 'version:commit', decision: 'denied' }],
      },
    });

    const surface = await version.getSurfaceStatus();

    expect(surface.capabilities['version:read']).toEqual({ enabled: true });
    expect(surface.capabilities['version:commit']).toMatchObject({
      enabled: false,
      dependency: 'hostCapability',
      retryable: false,
    });
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'version.surfaceStatus.hostCapabilityDenied',
    );
  });
});
