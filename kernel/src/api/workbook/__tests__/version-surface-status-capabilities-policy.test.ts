import { jest } from '@jest/globals';

import {
  HOST_DENIAL_SPLIT_CAPABILITIES,
  capabilityState,
  createSplitCapabilityReadyVersion,
  createSurfaceReadyVersionWithContext,
} from './version-surface-status-test-utils';

describe('WorkbookVersion surface status policy capabilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    'reports capability-specific host-denied disabled reason for %s without collapsing sibling capabilities',
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
        reason: `Host policy denies ${deniedCapability}.`,
        retryable: false,
      });

      const diagnostic = surface.diagnostics.find(
        (entry) =>
          entry.code === 'version.surfaceStatus.hostCapabilityDenied' &&
          entry.data?.capability === deniedCapability,
      );
      expect(diagnostic).toMatchObject({
        dependency: 'hostCapability',
        message: `Host policy denies ${deniedCapability}.`,
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
