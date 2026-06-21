import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';

const CHILD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
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
  'version:revert',
  'version:provenance',
] as const;

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

function createSurfaceReadyVersionWithContext(ctxOverrides: Record<string, unknown> = {}) {
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

describe('WorkbookVersion surface status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(Object.values(surface.capabilities).every((capability) => !capability.enabled)).toBe(true);
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.surfaceStatus.featureGateDefaultEnabled',
        'version.surfaceStatus.storageUnavailable',
        'version.surfaceStatus.readUnavailable',
        'version.surfaceStatus.dirtyTokenUnavailable',
      ]),
    );
  });

  it('enables surface capabilities for attached read, write, ref, checkout, and merge services', async () => {
    const surfaceReady = createSurfaceReadyVersion();

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.stage).toBe('merge');
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
      'version:mergeApply',
    ] as const) {
      expect(surface.capabilities[capability]).toEqual({ enabled: true });
    }
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

  it('keeps proposal, revert, and provenance disabled by upstream dependency', async () => {
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
      retryable: false,
    });
  });

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
