import { jest } from '@jest/globals';

import {
  CHILD_COMMIT_ID,
  capabilityState,
  createSurfaceReadyVersion,
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
});
