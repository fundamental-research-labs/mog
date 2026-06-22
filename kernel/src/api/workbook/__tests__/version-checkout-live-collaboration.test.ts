import { jest } from '@jest/globals';

import type { WorkbookConfig } from '../types';

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
    ...overrides,
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
      requiredDependencies: [
        { role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' },
      ],
    },
    diagnostics: [],
    mutationGuarantee: 'no-workbook-mutation',
  };
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
              statusRevision: `live:${collaborationState}`,
              roomId: 'room-1',
              sidecarStatus: collaborationState === 'active' ? 'online' : 'unknown',
              activeParticipantCount: collaborationState === 'active' ? 2 : 0,
            }),
          },
        }),
      });

      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          checkoutSafe: false,
          liveCollaboration: {
            state: collaborationState,
            roomId: 'room-1',
          },
          unsafeReasons: [
            expect.objectContaining({
              code: unsafeReasonCode,
              data: expect.objectContaining({
                collaborationState,
                roomId: 'room-1',
              }),
            }),
          ],
        },
      });

      await expect(wb.version.checkout({ kind: 'commit', id: commitId })).resolves.toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE',
              data: expect.objectContaining({
                payload: expect.objectContaining({
                  reason: 'liveCollaborationActive',
                  collaborationState,
                  roomId: 'room-1',
                }),
              }),
            }),
          ],
        },
      });
      expect(checkout).not.toHaveBeenCalled();
    },
  );

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
