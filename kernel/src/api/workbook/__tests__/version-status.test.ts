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

function createMockCtx() {
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

describe('WorkbookVersion status slice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes read-only version status on a created workbook', async () => {
    const wb = createWorkbook();

    const status = await wb.version.getStatus();

    expect(status.schemaVersion).toBe(1);
    expect(status.rolloutStage).toBe('shadow-only');
    expect(status.objectStoreFoundation.stage).toBe('present');
    expect(status.refLifecycleFoundation.stage).toBe('present');
    expect(status.commitApi.stage).toBe('pending');
    expect(status.checkout.stage).toBe('pending');
    expect(status.merge.stage).toBe('pending');
    expect(status.provenanceAdmission.stage).toBe('present');
    expect(status.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.objectStore.serviceUnavailable',
        'version.refLifecycle.serviceUnavailable',
        'version.commitApi.pending',
        'version.checkout.pending',
        'version.merge.pending',
        'version.provenanceAdmission.present',
      ]),
    );

    expect('commit' in wb.version).toBe(false);
    expect('checkout' in wb.version).toBe(false);
  });

  it('does not fabricate a head before a commit/ref service is attached', async () => {
    const wb = createWorkbook();

    await expect(wb.version.getHead()).resolves.toMatchObject({
      schemaVersion: 1,
      rolloutStage: 'shadow-only',
      head: null,
      diagnostics: [
        expect.objectContaining({
          code: 'version.head.serviceUnavailable',
          dependency: 'version-service',
        }),
      ],
    });
  });
});
