import { jest } from '@jest/globals';

import type { WorkbookConfig } from '../types';
import { checkoutWorkbookVersion } from '../version-checkout';
import {
  installVersionDomainDetectorNoopsOnBridgeMock,
  versioningWithDomainSupportManifest,
} from './version-domain-support-test-utils';

const createCheckpointManagerMock = jest.fn();
const worksheetImplMock = jest.fn().mockImplementation((sheetId: string) => ({
  _sheetId: sheetId,
  _syncMetadata: jest.fn(),
  dispose: jest.fn(),
}));

jest.unstable_mockModule('../../worksheet/worksheet-impl', () => ({
  WorksheetImpl: worksheetImplMock,
}));

jest.unstable_mockModule('../../../services/checkpoint', () => ({
  createCheckpointManager: createCheckpointManagerMock,
}));

jest.unstable_mockModule('../../namespaces/records', () => ({
  get: jest.fn(),
  query: jest.fn(),
  getFieldValue: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  del: jest.fn(),
}));

jest.unstable_mockModule('../../../bridges/compute/compute-bridge', () => ({
  ComputeBridge: jest.fn(),
  createComputeBridge: jest.fn(),
  createComputeBridgeFromTransport: jest.fn(),
  extractMutationData: jest.fn(),
  identityFormulaToWire: jest.fn(),
  rustSchemaResolveEditor: jest.fn(),
  wireTableToTableConfig: jest.fn(),
  wireToIdentityFormula: jest.fn(),
  __esModule: true,
}));

const { WorkbookImpl } = await import('../workbook-impl');

const RAW_ROOM_ID = 'raw-room-id:live-collaboration-room';
const RAW_USER_ID = 'raw-user-id:live-collaboration-user';
const RAW_PROVIDER_ID = 'raw-provider-id:live-collaboration-provider';

function createMockEventBus() {
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn().mockReturnValue(() => undefined),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  const versioning = overrides.versioning as Record<string, unknown> | undefined;
  const computeBridge = {};
  installVersionDomainDetectorNoopsOnBridgeMock(computeBridge);
  return {
    computeBridge,
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    ...overrides,
    ...(versioning ? { versioning: versioningWithDomainSupportManifest(versioning) } : {}),
  } as any;
}

function createWorkbook(overrides?: Partial<WorkbookConfig>) {
  createCheckpointManagerMock.mockReturnValue({
    create: jest.fn(),
    createSync: jest.fn(),
    restore: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  });

  return new WorkbookImpl({
    ctx: createMockCtx(),
    eventBus: createMockEventBus(),
    ...overrides,
  });
}

function plannedCheckoutResult(commitId: string) {
  return {
    ok: true,
    materialization: 'planned',
    plan: {
      strategy: 'fullSnapshot',
      commitId,
      parentCommitIds: [],
      resolvedTarget: { kind: 'commit', commitId },
      requiredDependencies: [{ role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' }],
    },
    diagnostics: [],
    mutationGuarantee: 'no-workbook-mutation',
  };
}

function cleanSurfaceDirtyStatus() {
  return {
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
  };
}

function expectNoRawCollaborationIdentifiers(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(RAW_ROOM_ID);
  expect(serialized).not.toContain(RAW_USER_ID);
  expect(serialized).not.toContain(RAW_PROVIDER_ID);
}

describe('WorkbookVersion checkout live collaboration admission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['active', 'version.surfaceStatus.liveCollaborationActive'],
    ['unknown', 'version.surfaceStatus.liveCollaborationUnknown'],
  ] as const)(
    'blocks checkout when live collaboration state is %s',
    async (collaborationState, unsafeReasonCode) => {
      const commitId = `commit:sha256:${'8'.repeat(64)}`;
      const checkout = jest.fn(async () => plannedCheckoutResult(commitId));
      const wb = createWorkbook({
        ctx: createMockCtx({
          versioning: {
            checkoutService: { checkout },
            readLiveCollaborationStatus: () => ({
              state: collaborationState,
              statusRevision: `live:${collaborationState}:${RAW_ROOM_ID}:${RAW_USER_ID}:${RAW_PROVIDER_ID}`,
              roomId: RAW_ROOM_ID,
              userId: RAW_USER_ID,
              providerId: RAW_PROVIDER_ID,
              sidecarStatus: collaborationState === 'active' ? 'online' : 'unknown',
              activeParticipantCount: collaborationState === 'active' ? 2 : 0,
              diagnostics: [
                {
                  code: 'version.surfaceStatus.liveCollaborationUnknown',
                  severity: 'warning',
                  message: `Raw live collaboration ids ${RAW_ROOM_ID} ${RAW_USER_ID} ${RAW_PROVIDER_ID} must not leak.`,
                  dependency: 'VC-09',
                  data: {
                    roomId: RAW_ROOM_ID,
                    userId: RAW_USER_ID,
                    providerId: RAW_PROVIDER_ID,
                    note: `provider ${RAW_PROVIDER_ID}`,
                    safeCount: 1,
                  },
                },
              ],
            }),
          },
        }),
      });

      const surfaceStatus = await wb.version.getSurfaceStatus();
      expect(surfaceStatus).toMatchObject({
        dirty: {
          checkoutSafe: false,
          liveCollaboration: {
            state: collaborationState,
            roomId: 'redacted',
          },
          unsafeReasons: [
            expect.objectContaining({
              code: unsafeReasonCode,
              data: expect.objectContaining({
                collaborationState,
                roomId: 'redacted',
                redacted: true,
              }),
            }),
          ],
        },
      });
      expect(surfaceStatus.dirty.liveCollaboration?.statusRevision).toContain('room:redacted');
      expect(surfaceStatus.dirty.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Raw live collaboration ids redacted redacted redacted must not leak.',
            data: expect.objectContaining({
              roomId: 'redacted',
              userId: 'redacted',
              providerId: 'redacted',
              note: 'provider redacted',
              safeCount: 1,
              redacted: true,
            }),
          }),
        ]),
      );
      expectNoRawCollaborationIdentifiers(surfaceStatus);

      const checkoutResult = await wb.version.checkout({ kind: 'commit', id: commitId });
      expect(checkoutResult).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE',
              data: expect.objectContaining({
                payload: expect.objectContaining({
                  reason: 'liveCollaborationActive',
                  collaborationState,
                  roomId: 'redacted',
                }),
              }),
            }),
          ],
        },
      });
      expectNoRawCollaborationIdentifiers(checkoutResult);
      expect(checkout).not.toHaveBeenCalled();
    },
  );

  it('fails closed and redacts identifiers when live collaboration state is malformed', async () => {
    const commitId = `commit:sha256:${'7'.repeat(64)}`;
    const checkout = jest.fn(async () => plannedCheckoutResult(commitId));
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout },
          readLiveCollaborationStatus: () => ({
            state: 'joining',
            statusRevision: `live:joining:${RAW_ROOM_ID}:${RAW_USER_ID}:${RAW_PROVIDER_ID}`,
            roomId: RAW_ROOM_ID,
            userId: RAW_USER_ID,
            providerId: RAW_PROVIDER_ID,
          }),
        },
      }),
    });

    const surfaceStatus = await wb.version.getSurfaceStatus();
    expect(surfaceStatus).toMatchObject({
      dirty: {
        checkoutSafe: false,
        liveCollaboration: {
          state: 'unknown',
        },
        unsafeReasons: [
          expect.objectContaining({
            code: 'version.surfaceStatus.liveCollaborationUnknown',
            data: expect.objectContaining({
              collaborationState: 'unknown',
            }),
          }),
        ],
      },
    });
    expectNoRawCollaborationIdentifiers(surfaceStatus);

    const checkoutResult = await wb.version.checkout({ kind: 'commit', id: commitId });
    expect(checkoutResult).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                reason: 'liveCollaborationActive',
                collaborationState: 'unknown',
              }),
            }),
          }),
        ],
      },
    });
    expectNoRawCollaborationIdentifiers(checkoutResult);
    expect(checkout).not.toHaveBeenCalled();
  });

  it.each([
    ['provider-disconnected', false, 'disconnected'],
    ['provider-quarantine', true, 'quarantined'],
    ['provider-authority-stale', true, 'stale'],
    ['provider-active', true, 'active'],
    ['provider-status-unknown', true, 'unknown'],
  ] as const)(
    'blocks checkout when idle live collaboration reports %s lifecycle',
    async (sidecarStatus, remoteProviderAttached, providerLifecycleState) => {
      const commitId = `commit:sha256:${'6'.repeat(64)}`;
      const checkout = jest.fn(async () => plannedCheckoutResult(commitId));
      const wb = createWorkbook({
        ctx: createMockCtx({
          versioning: {
            checkoutService: { checkout },
            readLiveCollaborationStatus: () => ({
              state: 'idle',
              statusRevision: `live:idle:${sidecarStatus}:${RAW_PROVIDER_ID}`,
              roomId: RAW_ROOM_ID,
              providerId: RAW_PROVIDER_ID,
              sidecarStatus,
              activeParticipantCount: 0,
              remoteProviderAttached,
            }),
          },
        }),
      });

      const surfaceStatus = await wb.version.getSurfaceStatus();
      expect(surfaceStatus).toMatchObject({
        dirty: {
          checkoutSafe: false,
          liveCollaboration: { state: 'idle', roomId: 'redacted', sidecarStatus },
          unsafeReasons: [
            expect.objectContaining({
              code: 'version.surfaceStatus.liveCollaborationUnknown',
              data: expect.objectContaining({
                collaborationState: 'idle',
                providerLifecycleState,
                sidecarStatus,
                remoteProviderAttached,
              }),
            }),
          ],
        },
      });
      expectNoRawCollaborationIdentifiers(surfaceStatus);

      const checkoutResult = await wb.version.checkout({ kind: 'commit', id: commitId });
      expect(checkoutResult).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE',
              data: expect.objectContaining({
                payload: expect.objectContaining({
                  reason: 'liveCollaborationActive',
                  collaborationState: 'idle',
                  sidecarStatus,
                  remoteProviderAttached,
                }),
              }),
            }),
          ],
        },
      });
      expectNoRawCollaborationIdentifiers(checkoutResult);
      expect(checkout).not.toHaveBeenCalled();
    },
  );

  it('blocks checkout while workbook recalculation is pending', async () => {
    const commitId = `commit:sha256:${'a'.repeat(64)}`;
    const checkout = jest.fn(async () => plannedCheckoutResult(commitId));
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout },
        },
      }),
    });

    wb.suspendCalc();

    await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
      dirty: {
        pendingRecalc: true,
        checkoutSafe: false,
        unsafeReasons: [
          expect.objectContaining({
            code: 'version.surfaceStatus.pendingRecalc',
          }),
        ],
      },
    });

    await expect(wb.version.checkout({ kind: 'commit', id: commitId })).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_PENDING_RECALC',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                reason: 'pendingRecalc',
                targetKind: 'commit',
                commitId,
              }),
            }),
          }),
        ],
      },
    });
    expect(checkout).not.toHaveBeenCalled();
  });

  it('blocks checkout when the active checkout session is stale relative to its ref head', async () => {
    const checkedOutCommitId = `commit:sha256:${'b'.repeat(64)}`;
    const movedCommitId = `commit:sha256:${'c'.repeat(64)}`;
    const targetCommitId = `commit:sha256:${'d'.repeat(64)}`;
    const checkout = jest.fn(async () => plannedCheckoutResult(targetCommitId));
    const readRef = jest.fn(async (name: string) => ({
      status: 'success',
      ref: {
        name,
        commitId: movedCommitId,
        revision: { kind: 'counter', value: '2' },
      },
      diagnostics: [],
    }));

    await expect(
      checkoutWorkbookVersion(
        createMockCtx({
          versioning: {
            checkoutService: { checkout },
            readService: { readRef },
            surfaceStatusService: {
              readDirtyStatus: () => cleanSurfaceDirtyStatus(),
              readActiveCheckoutSession: () => ({
                checkedOutCommitId,
                branchName: 'main',
                refHeadAtMaterialization: checkedOutCommitId,
                detached: false,
              }),
            },
          },
        }),
        { kind: 'commit', id: targetCommitId },
      ),
    ).resolves.toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
          recoverability: 'retry',
          payload: expect.objectContaining({
            reason: 'staleWorkspaceHead',
            staleReason: 'refMoved',
            targetKind: 'commit',
            commitId: targetCommitId,
            branchName: 'main',
            checkedOutCommitId,
            refHeadAtMaterialization: checkedOutCommitId,
            currentRefHeadId: movedCommitId,
          }),
        }),
      ],
    });
    expect(readRef).toHaveBeenCalledWith('refs/heads/main');
    expect(checkout).not.toHaveBeenCalled();
  });

  it.each(['absent', 'disabled', 'idle'] as const)(
    'allows checkout when live collaboration state is %s',
    async (collaborationState) => {
      const commitId = `commit:sha256:${'9'.repeat(64)}`;
      const checkout = jest.fn(async () => plannedCheckoutResult(commitId));
      const wb = createWorkbook({
        ctx: createMockCtx({
          versioning: {
            checkoutService: { checkout },
            readLiveCollaborationStatus: () => ({
              state: collaborationState,
              statusRevision: `live:${collaborationState}`,
            }),
          },
        }),
      });

      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          checkoutSafe: true,
          liveCollaboration: {
            state: collaborationState,
          },
          unsafeReasons: [],
        },
      });

      await expect(wb.version.checkout({ kind: 'commit', id: commitId })).resolves.toMatchObject({
        ok: true,
        value: {
          materialization: 'planned',
          mutationGuarantee: 'no-workbook-mutation',
        },
      });
      expect(checkout).toHaveBeenCalledTimes(1);
    },
  );
});
