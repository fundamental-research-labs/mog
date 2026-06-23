import { jest } from '@jest/globals';

import {
  CHILD_COMMIT_ID,
  HOST_DENIAL_SPLIT_CAPABILITIES,
  capabilityState,
  createCompleteProposalService,
  createSplitCapabilityReadyVersion,
  createSurfaceReadyVersion,
  createSurfaceReadyVersionWithContext,
} from './version-surface-status-test-utils';

describe('WorkbookVersion surface status capabilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
