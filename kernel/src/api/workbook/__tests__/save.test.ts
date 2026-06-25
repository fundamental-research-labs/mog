import { jest } from '@jest/globals';

import type { SheetId } from '@mog-sdk/contracts/core';
import { sheetId } from '@mog-sdk/contracts/core';
import { MogSdkError } from '../../../errors';
import type { WorkbookConfig } from '../types';
import {
  installVersionDomainDetectorNoopsOnBridgeMock,
  versionDomainSupportManifestRuntime,
} from './version-domain-support-test-utils';

const worksheetImplMock = jest.fn().mockImplementation((id: SheetId) => ({
  _sheetId: id,
  _syncMetadata: jest.fn(),
  dispose: jest.fn(),
}));
const getOrderMock = jest.fn();
const getNameMock = jest.fn();
const createCheckpointManagerMock = jest.fn();

jest.unstable_mockModule('../../worksheet/worksheet-impl', () => ({
  WorksheetImpl: worksheetImplMock,
}));

jest.unstable_mockModule('../../../domain/sheets/sheet-meta', () => ({
  getMeta: jest.fn(),
  getOrder: getOrderMock,
  getFirstId: jest.fn(),
  getName: getNameMock,
  getUsedRangeEnd: jest.fn(),
  getUsedRange: jest.fn(),
  setUsedRange: jest.fn(),
  getFrozenPanes: jest.fn(),
  setFrozenPanes: jest.fn(),
  getPageBreaks: jest.fn(),
  setPageBreaks: jest.fn(),
  getPrintSettings: jest.fn(),
  setPrintSettings: jest.fn(),
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

const fakeBuffer = new Uint8Array([
  0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

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
  const computeBridge = {
    exportToXlsxBytes: jest.fn().mockResolvedValue(fakeBuffer),
    isSheetHidden: jest.fn().mockResolvedValue(false),
  };
  installVersionDomainDetectorNoopsOnBridgeMock(computeBridge);

  return {
    computeBridge,
    eventBus: createMockEventBus(),
    writeGate: {
      assertWritable: jest.fn(),
      captureHighWaterMark: jest.fn().mockReturnValue({
        mutationWatermark: 0,
        providerOriginWatermarks: {},
        inboundBarrierActive: false,
        pendingAssetCount: 0,
      }),
    },
    operationGate: {
      authorizeExport: jest.fn().mockResolvedValue(undefined),
    },
    mirror: {
      getWorkbookSettings: jest.fn().mockReturnValue({}),
      getSheetIds: jest.fn().mockReturnValue([sheetId('sheet1')]),
      getSheetMeta: jest.fn().mockReturnValue({ name: 'Sheet1', hidden: false }),
    },
    services: {
      undo: {
        subscribe: jest
          .fn()
          .mockReturnValue(Object.assign(() => undefined, { dispose: jest.fn() })),
        canUndo: jest.fn().mockReturnValue(false),
        canRedo: jest.fn().mockReturnValue(false),
        getState: jest.fn().mockReturnValue({
          canUndo: false,
          canRedo: false,
          undoStackSize: 0,
          redoStackSize: 0,
          nextUndoDescription: null,
          nextRedoDescription: null,
        }),
      },
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    ...overrides,
  } as any;
}

async function createWorkbook(
  overrides?: Partial<WorkbookConfig>,
  ctxOverrides: Record<string, unknown> = {},
) {
  getOrderMock.mockResolvedValue([sheetId('sheet1')]);
  getNameMock.mockResolvedValue('Sheet1');
  createCheckpointManagerMock.mockReturnValue({
    create: jest.fn(),
    createSync: jest.fn(),
    restore: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  });

  const ctx = createMockCtx(ctxOverrides);
  const wb = new WorkbookImpl({
    ctx,
    eventBus: createMockEventBus(),
    ...overrides,
  });
  await wb._init();
  return { wb, ctx };
}

describe('WorkbookImpl.save', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('save(path) writes through the configured file writer and still returns XLSX bytes', async () => {
    const writeFile = jest.fn().mockResolvedValue(undefined);
    const { wb, ctx } = await createWorkbook({ writeFile });

    const result = await wb.save('output.xlsx');

    expect(result).toBe(fakeBuffer);
    expect(writeFile).toHaveBeenCalledWith('output.xlsx', fakeBuffer);
    expect(ctx.computeBridge.exportToXlsxBytes).toHaveBeenCalledTimes(1);
    wb.dispose();
  });

  it('rejects version-capable toXlsx before host authorization when no domain support manifest is attached', async () => {
    const { wb, ctx } = await createWorkbook(undefined, {
      versioning: { writeService: { commit: jest.fn() } },
    });

    await expect(wb.toXlsx()).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'EXPORT_ERROR',
      operation: 'workbook.toXlsx',
      diagnostics: {
        domain: 'VERSION',
        issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
        severity: 'error',
      },
      details: {
        issue: 'export-domain-support-manifest-blocked',
        operation: 'workbook.toXlsx',
        mutationGuarantee: 'no-write-attempted',
        diagnostics: [
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({ operation: 'export' }),
          }),
        ],
      },
    });
    expect(ctx.operationGate.authorizeExport).not.toHaveBeenCalled();
    expect(ctx.computeBridge.exportToXlsxBytes).not.toHaveBeenCalled();
    wb.dispose();
  });

  it('rejects save before exporting or writing when version-capable export lacks a domain support manifest', async () => {
    const writeFile = jest.fn().mockResolvedValue(undefined);
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { wb, ctx } = await createWorkbook(
      { writeFile, onSave },
      { versioning: { writeService: { commit: jest.fn() } } },
    );

    await expect(wb.save('output.xlsx')).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'EXPORT_ERROR',
      operation: 'workbook.toXlsx',
      diagnostics: {
        issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
      },
      details: {
        issue: 'export-domain-support-manifest-blocked',
        diagnostics: [
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
            payload: expect.objectContaining({ operation: 'export' }),
          }),
        ],
      },
    });
    expect(ctx.operationGate.authorizeExport).not.toHaveBeenCalled();
    expect(ctx.computeBridge.exportToXlsxBytes).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    wb.dispose();
  });

  it('allows version-capable toXlsx when the manifest proves required export coverage', async () => {
    const { wb, ctx } = await createWorkbook(undefined, {
      versioning: {
        writeService: { commit: jest.fn() },
        ...versionDomainSupportManifestRuntime(),
      },
    });

    await expect(wb.toXlsx()).resolves.toBe(fakeBuffer);
    expect(ctx.operationGate.authorizeExport).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.exportToXlsxBytes).toHaveBeenCalledTimes(1);
    wb.dispose();
  });

  it('rejects version-capable toXlsx when the manifest does not prove export capability', async () => {
    const manifestRuntime = versionDomainSupportManifestRuntime();
    const { wb, ctx } = await createWorkbook(undefined, {
      versioning: {
        writeService: { commit: jest.fn() },
        ...manifestRuntime,
        domainSupportManifest: {
          ...manifestRuntime.domainSupportManifest,
          domains: manifestRuntime.domainSupportManifest.domains.map((row) =>
            row.matrixRowId === 'cells.values'
              ? {
                  ...row,
                  capabilityStates: {
                    ...row.capabilityStates,
                    export: 'contracted',
                  },
                }
              : row,
          ),
        },
      },
    });

    await expect(wb.toXlsx()).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'EXPORT_ERROR',
      operation: 'workbook.toXlsx',
      diagnostics: {
        issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
      },
      details: {
        issue: 'export-domain-support-manifest-blocked',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            payload: expect.objectContaining({
              operation: 'export',
              diagnosticCode: 'capability-state-blocked',
              capabilityKey: 'export',
            }),
          }),
        ]),
      },
    });
    expect(ctx.operationGate.authorizeExport).not.toHaveBeenCalled();
    expect(ctx.computeBridge.exportToXlsxBytes).not.toHaveBeenCalled();
    wb.dispose();
  });

  it('rejects empty paths before exporting', async () => {
    const writeFile = jest.fn().mockResolvedValue(undefined);
    const { wb, ctx } = await createWorkbook({ writeFile });

    await expect(wb.save('')).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'INVALID_ARGUMENT',
      operation: 'workbook.save',
      details: {
        issue: 'save-path-invalid',
        operation: 'workbook.save',
        requestedPath: '',
      },
    });
    expect(ctx.computeBridge.exportToXlsxBytes).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    wb.dispose();
  });

  it('rejects non-string paths with an agent-readable MogSdkError', async () => {
    const { wb, ctx } = await createWorkbook();

    await expect(wb.save(null as never)).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'INVALID_ARGUMENT',
      operation: 'workbook.save',
      message: expect.stringContaining('expected path to be a string'),
      details: {
        issue: 'save-path-invalid',
        operation: 'workbook.save',
        receivedType: 'null',
      },
    });
    expect(ctx.computeBridge.exportToXlsxBytes).not.toHaveBeenCalled();
    wb.dispose();
  });

  it('rejects before exporting when no file writer is configured', async () => {
    const { wb, ctx } = await createWorkbook();

    await expect(wb.save('output.xlsx')).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'INVALID_ARGUMENT',
      operation: 'workbook.save',
      message: expect.stringContaining('no file writer is configured'),
      details: {
        issue: 'save-path-writer-unavailable',
        operation: 'workbook.save',
        requestedPath: 'output.xlsx',
      },
    });
    expect(ctx.computeBridge.exportToXlsxBytes).not.toHaveBeenCalled();
    wb.dispose();
  });

  it('wraps host writer failures with path, cwd, and filesystem details', async () => {
    const cause = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
      requestedPath: 'outputs/model.xlsx',
      absolutePath: '/tmp/mog/outputs/model.xlsx',
      cwd: '/tmp/mog',
      parentDirectory: '/tmp/mog/outputs',
    });
    const writeFile = jest.fn().mockRejectedValue(cause);
    const { wb } = await createWorkbook({ writeFile });

    let thrown: unknown;
    try {
      await wb.save('outputs/model.xlsx');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MogSdkError);
    expect(thrown).toMatchObject({
      code: 'PROVIDER_ERROR',
      operation: 'workbook.save',
      message: expect.stringContaining('Current working directory: "/tmp/mog"'),
      details: {
        issue: 'save-path-write-failed',
        operation: 'workbook.save',
        requestedPath: 'outputs/model.xlsx',
        absolutePath: '/tmp/mog/outputs/model.xlsx',
        cwd: '/tmp/mog',
        parentDirectory: '/tmp/mog/outputs',
        filesystemCode: 'EACCES',
        causeMessage: 'permission denied',
      },
    });
    expect((thrown as Error).cause).toBe(cause);
    wb.dispose();
  });

  it('wraps host save callback failures as provider errors', async () => {
    const cause = new Error('host save failed');
    const onSave = jest.fn().mockRejectedValue(cause);
    const { wb } = await createWorkbook({ onSave });

    await expect(wb.save()).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'PROVIDER_ERROR',
      operation: 'workbook.save',
      message: expect.stringContaining('host save callback failed'),
      details: {
        issue: 'save-callback-failed',
        operation: 'workbook.save',
        causeMessage: 'host save failed',
      },
    });
    expect(onSave).toHaveBeenCalledWith(fakeBuffer);
    wb.dispose();
  });
});
