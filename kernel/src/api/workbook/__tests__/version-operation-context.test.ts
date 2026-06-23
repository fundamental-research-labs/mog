import { jest } from '@jest/globals';

import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { BridgeTransport } from '@rust-bridge/client';

import { ComputeBridge } from '../../../bridges/compute/compute-bridge';
import type { MutationResult } from '../../../bridges/compute/compute-types.gen';
import type { MutationAdmissionDiagnostic } from '../../../bridges/compute/mutation-admission';
import { WorksheetImpl } from '../../worksheet/worksheet-impl';
import { WorkbookSheetsImpl, type WorkbookSheetsDeps } from '../sheets';

const DOCUMENT_ID = 'version-operation-context-test-doc';
const SHEET_ID = toSheetId('sheet-1');
const SECOND_SHEET_ID = toSheetId('sheet-2');
const CREATED_AT_MS = Date.parse('2026-06-23T12:00:00.000Z');

function mutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
    ...overrides,
  } as MutationResult;
}

function createTransport(): BridgeTransport & { call: jest.Mock } {
  return {
    call: jest.fn(async (command: string) => {
      switch (command) {
        case 'compute_batch_set_cells_by_position':
          return [new Uint8Array(), mutationResult()];
        case 'compute_create_sheet_with_default_col_width':
          return ['sheet-created', mutationResult()];
        case 'compute_rename_compute_sheet':
        case 'compute_delete_sheet':
          return [new Uint8Array(), mutationResult()];
        case 'compute_begin_undo_group':
        case 'compute_end_undo_group':
          return undefined;
        default:
          throw new Error(`unexpected transport command: ${command}`);
      }
    }),
  } as unknown as BridgeTransport & { call: jest.Mock };
}

function createBridgeFixture() {
  const capture = {
    recordPreMutation: jest.fn(async () => undefined),
    recordMutationResult: jest.fn(),
  };
  const diagnostics: MutationAdmissionDiagnostic[] = [];
  const ctx = {
    eventBus: { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
    services: {
      undo: {
        notifyForwardMutation: jest.fn(async () => undefined),
      },
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
    clock: {
      now: jest.fn(() => CREATED_AT_MS),
    },
    workbookLinkScope: jest.fn(() => ({
      actor: 'user-1',
      requestingDocumentId: DOCUMENT_ID,
      requestingSessionId: 'session-1',
    })),
    awaitMaterialized: jest.fn(async () => undefined),
    mirror: {
      getSheetSettings: jest.fn(() => ({ isProtected: false })),
      getFrozenPanes: jest.fn(() => ({ rows: 0, cols: 0 })),
      getViewOptions: jest.fn(() => ({
        showGridlines: true,
        showRowHeaders: true,
        showColumnHeaders: true,
      })),
    },
    versioning: {
      mutationCapture: capture,
    },
    versioningAdmissionDiagnostics: {
      record: (diagnostic: MutationAdmissionDiagnostic) => diagnostics.push(diagnostic),
    },
  } as unknown as IKernelContext & {
    computeBridge: ComputeBridge;
    writeGate: { assertWritable: jest.Mock };
  };
  const transport = createTransport();
  const bridge = new ComputeBridge(ctx, DOCUMENT_ID, transport);
  (bridge as any).core._phase = 'STARTED';
  (bridge as any).core.engineCreated = true;
  ctx.computeBridge = bridge;

  bridge.canEditCell = jest.fn(async () => true) as any;
  bridge.isSheetProtected = jest.fn(async () => false) as any;
  bridge.getTableAtCell = jest.fn(async () => null) as any;
  bridge.getAllTablesInSheet = jest.fn(async () => []) as any;
  bridge.getActiveFilters = jest.fn(async () => []) as any;
  bridge.applyFilter = jest.fn(async () => undefined) as any;
  bridge.isWorkbookProtected = jest.fn(async () => false) as any;
  bridge.isSheetHidden = jest.fn(async () => false) as any;
  bridge.findCellsByFormula = jest.fn(async () => []) as any;

  return { bridge, capture, ctx, diagnostics, transport };
}

function clearCapture(capture: {
  recordPreMutation: jest.Mock;
  recordMutationResult: jest.Mock;
}): void {
  capture.recordPreMutation.mockClear();
  capture.recordMutationResult.mockClear();
}

function expectCapturedContext(
  capture: {
    recordPreMutation: jest.Mock;
    recordMutationResult: jest.Mock;
  },
  expected: {
    operation: string;
    operationIdPrefix: string;
    domainIds: readonly string[];
    sheetIds?: readonly string[];
  },
): void {
  const operationContext = expect.objectContaining({
    operationId: expect.stringMatching(new RegExp(`^${escapeRegExp(expected.operationIdPrefix)}:`)),
    kind: 'mutation',
    author: expect.objectContaining({
      authorId: 'user-1',
      actorKind: 'user',
      sessionId: 'session-1',
    }),
    createdAt: new Date(CREATED_AT_MS).toISOString(),
    workbookId: DOCUMENT_ID,
    domainIds: [...expected.domainIds],
    ...(expected.sheetIds ? { sheetIds: [...expected.sheetIds] } : {}),
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
  });
  expect(capture.recordPreMutation).toHaveBeenCalledWith({
    operation: expected.operation,
    operationContext,
  });
  expect(capture.recordMutationResult).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: expected.operation,
      operationContext,
    }),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createWorksheetFixture() {
  const bridgeFixture = createBridgeFixture();
  const worksheet = new WorksheetImpl(SHEET_ID, bridgeFixture.ctx as any, {
    name: 'Sheet1',
    index: 0,
  });
  return { ...bridgeFixture, worksheet };
}

function createSheetsFixture() {
  const bridgeFixture = createBridgeFixture();
  const names = new Map<SheetId, string>([
    [SHEET_ID, 'Sheet1'],
    [SECOND_SHEET_ID, 'Sheet2'],
  ]);
  bridgeFixture.bridge.getAllSheetIds = jest.fn(async () => [SHEET_ID, SECOND_SHEET_ID]) as any;
  bridgeFixture.bridge.getSheetOrder = jest.fn(async () => [SECOND_SHEET_ID]) as any;
  bridgeFixture.bridge.getSheetName = jest.fn(async (id: SheetId) => names.get(id) ?? null) as any;

  const workbook = {
    _getOrCreateWorksheet: jest.fn((id: SheetId, name?: string) => ({ id, name })),
    refreshSheetMetadata: jest.fn(async () => undefined),
  };
  const deps: WorkbookSheetsDeps = {
    ctx: bridgeFixture.ctx as any,
    resolveTarget: jest.fn(async (target: number | string) => {
      if (typeof target === 'number') return [SHEET_ID, SECOND_SHEET_ID][target];
      for (const [id, name] of names) {
        if (name.toLowerCase() === target.toLowerCase()) return id;
      }
      return toSheetId(String(target));
    }),
    getSheetName: jest.fn(async (id: SheetId) => names.get(id)),
    getSheetCount: jest.fn(async () => names.size - 1),
    setActiveSheetId: jest.fn(),
    workbook: workbook as any,
  };
  const sheets = new WorkbookSheetsImpl(deps);
  return { ...bridgeFixture, deps, sheets };
}

describe('VersionOperationContext propagation for public worksheet writes', () => {
  it.each([
    {
      name: 'setCell',
      operationIdPrefix: 'worksheet.setCell',
      run: (worksheet: WorksheetImpl) => worksheet.setCell('A1', 'value'),
    },
    {
      name: 'setCells',
      operationIdPrefix: 'worksheet.setCells',
      run: (worksheet: WorksheetImpl) => worksheet.setCells([{ address: 'B1', value: 42 }]),
    },
    {
      name: 'setRange',
      operationIdPrefix: 'worksheet.setRange',
      run: (worksheet: WorksheetImpl) => worksheet.setRange('C1:D1', [[1, 2]]),
    },
  ])('$name carries context into version capture', async ({ operationIdPrefix, run }) => {
    const { capture, worksheet } = createWorksheetFixture();

    await run(worksheet);

    expectCapturedContext(capture, {
      operation: 'compute_batch_set_cells_by_position',
      operationIdPrefix,
      sheetIds: [SHEET_ID],
      domainIds: ['cells'],
    });
  });
});

describe('VersionOperationContext propagation for public sheet writes', () => {
  it('sheet add carries context into version capture', async () => {
    const { capture, sheets } = createSheetsFixture();

    await sheets.add('Revenue');

    expectCapturedContext(capture, {
      operation: 'compute_create_sheet_with_default_col_width',
      operationIdPrefix: 'workbook.sheets.add',
      domainIds: ['sheets'],
    });
  });

  it('sheet rename carries context into version capture', async () => {
    const { capture, sheets } = createSheetsFixture();

    await sheets.rename('Sheet1', 'Renamed');

    expectCapturedContext(capture, {
      operation: 'compute_rename_compute_sheet',
      operationIdPrefix: 'workbook.sheets.rename',
      sheetIds: [SHEET_ID],
      domainIds: ['sheets'],
    });
  });

  it('sheet remove carries context into version capture', async () => {
    const { capture, sheets } = createSheetsFixture();

    await sheets.remove('Sheet1');

    expectCapturedContext(capture, {
      operation: 'compute_delete_sheet',
      operationIdPrefix: 'workbook.sheets.remove',
      sheetIds: [SHEET_ID],
      domainIds: ['sheets'],
    });
  });
});

describe('VersionOperationContext fail-closed admission for public worksheet/sheet writes', () => {
  it.each([
    ['compute_batch_set_cells_by_position'],
    ['compute_create_sheet_with_default_col_width'],
    ['compute_rename_compute_sheet'],
    ['compute_delete_sheet'],
  ])('rejects %s before transport when context is missing', async (operation) => {
    const { bridge, capture, diagnostics, transport } = createBridgeFixture();
    clearCapture(capture);

    await expect(
      bridge.core.mutatePublic(operation, () =>
        Promise.resolve([new Uint8Array(), mutationResult()] as [Uint8Array, MutationResult]),
      ),
    ).rejects.toThrow(
      `VersionOperationContext is required for capture-required public mutation '${operation}'.`,
    );

    expect(capture.recordPreMutation).not.toHaveBeenCalled();
    expect(capture.recordMutationResult).not.toHaveBeenCalled();
    expect(transport.call).not.toHaveBeenCalled();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'versioning.admission.missing-context',
        severity: 'error',
        command: operation,
      }),
    ]);
  });
});
