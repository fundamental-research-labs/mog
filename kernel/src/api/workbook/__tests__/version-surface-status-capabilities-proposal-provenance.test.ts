import { jest } from '@jest/globals';

import {
  createCompleteProposalService,
  createSurfaceReadyVersion,
  createSurfaceReadyVersionWithContext,
} from './version-surface-status-test-utils';

describe('WorkbookVersion surface status proposal and provenance capabilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
