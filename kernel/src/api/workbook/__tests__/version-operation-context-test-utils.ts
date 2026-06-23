import { jest } from '@jest/globals';

import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';
import type { BridgeTransport } from '@rust-bridge/client';

import { ComputeBridge } from '../../../bridges/compute/compute-bridge';
import type { MutationResult } from '../../../bridges/compute/compute-types.gen';
import type { MutationAdmissionDiagnostic } from '../../../bridges/compute/mutation-admission';
import { WorksheetImpl } from '../../worksheet/worksheet-impl';
import { WorkbookSheetsImpl, type WorkbookSheetsDeps } from '../sheets';

export const DOCUMENT_ID = 'version-operation-context-test-doc';
export const SHEET_ID = toSheetId('sheet-1');
export const SECOND_SHEET_ID = toSheetId('sheet-2');
export const CREATED_AT_MS = Date.parse('2026-06-23T12:00:00.000Z');

type MutationCapture = {
  recordPreMutation: jest.Mock;
  recordMutationResult: jest.Mock;
};

export function mutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
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
        case 'compute_copy_sheet':
          return ['sheet-copied', mutationResult()];
        case 'compute_rename_compute_sheet':
        case 'compute_delete_sheet':
        case 'compute_move_sheet':
          return [new Uint8Array(), mutationResult()];
        case 'compute_full_recalc':
          return mutationResult().recalc;
        case 'compute_begin_undo_group':
        case 'compute_end_undo_group':
          return undefined;
        default:
          throw new Error(`unexpected transport command: ${command}`);
      }
    }),
  } as unknown as BridgeTransport & { call: jest.Mock };
}

export function createBridgeFixture() {
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

export function clearCapture(capture: MutationCapture): void {
  capture.recordPreMutation.mockClear();
  capture.recordMutationResult.mockClear();
}

export function expectCapturedContext(
  capture: MutationCapture,
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

export function capturedPreMutationInputs(
  capture: Pick<MutationCapture, 'recordPreMutation'>,
): Array<{ operation: string; operationContext: VersionOperationContext }> {
  return capture.recordPreMutation.mock.calls.map(([input]) => input) as Array<{
    operation: string;
    operationContext: VersionOperationContext;
  }>;
}

export function expectGroupedCommandIdentity(
  inputs: readonly { operation: string; operationContext: VersionOperationContext }[],
  expected: {
    readonly operations: readonly string[];
    readonly operationIdPrefix: string;
    readonly rejectedOperationIdPrefix: string;
  },
): void {
  expect(inputs.map((input) => input.operation)).toEqual(expected.operations);
  const [outer, nested] = inputs.map((input) => input.operationContext);
  expect(outer?.groupId).toBe(outer?.operationId);
  expect(nested?.groupId).toBe(outer?.groupId);
  expect(outer?.operationId).toMatch(new RegExp(`^${escapeRegExp(expected.operationIdPrefix)}:`));
  expect(nested?.operationId).toMatch(new RegExp(`^${escapeRegExp(expected.operationIdPrefix)}:`));
  expect(nested?.operationId).not.toMatch(
    new RegExp(`^${escapeRegExp(expected.rejectedOperationIdPrefix)}:`),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createWorksheetFixture() {
  const bridgeFixture = createBridgeFixture();
  const worksheet = new WorksheetImpl(SHEET_ID, bridgeFixture.ctx as any, {
    name: 'Sheet1',
    index: 0,
  });
  return { ...bridgeFixture, worksheet };
}

export function createSheetsFixture() {
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
