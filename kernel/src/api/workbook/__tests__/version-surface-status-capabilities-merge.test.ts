import { jest } from '@jest/globals';

import { createSurfaceReadyVersionWithContext } from './version-surface-status-test-utils';

describe('WorkbookVersion surface status merge capabilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
