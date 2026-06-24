import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

(globalThis as any).window = {};

import type { BridgeTransport } from '@rust-bridge/client';
import { sheetId } from '@mog-sdk/contracts/core';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';

import { WriteGate } from '../../../document/write-gate';
import { ComputeBridge } from '../compute-bridge';
import { ComputeCore } from '../compute-core';
import type { MutationResult } from '../compute-types.gen';
import { classifyWriteOperation, type OperationInvocationKind } from '../operation-classification';
import type { MutationAdmissionDiagnostic } from '../mutation-admission';

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

function makeMockContext(overrides: Partial<IKernelContext> = {}): IKernelContext {
  return {
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
    ...overrides,
  } as unknown as IKernelContext;
}

function createStartedCore(ctx: IKernelContext, transport: BridgeTransport): ComputeCore {
  const core = new ComputeCore(ctx, 'test-doc', transport);
  (core as any)._phase = 'STARTED';
  (core as any).engineCreated = true;
  return core;
}

function createStartedBridge(ctx: IKernelContext, transport: BridgeTransport): ComputeBridge {
  const bridge = new ComputeBridge(ctx, 'test-doc', transport);
  (bridge as any).core._phase = 'STARTED';
  (bridge as any).core.engineCreated = true;
  return bridge;
}

function repoRoot(): string {
  return process.cwd().endsWith('/kernel') ? resolve(process.cwd(), '..') : process.cwd();
}

function invocationFromWrapper(wrapper: string): OperationInvocationKind | undefined {
  if (wrapper === 'mutateSystem' || wrapper === 'mutateSystemResult') return 'system-mutation';
  if (wrapper === 'mutatePublicUiState') return 'public-ui-state';
  if (wrapper === 'direct-compute-api') return 'direct-compute-api';
  if (wrapper === 'transport.call') return 'lifecycle';
  return undefined;
}

describe('Compute mutation admission', () => {
  it('classifies every mutating command in the VC-02 bridge write inventory', () => {
    const inventoryPath = resolve(
      repoRoot(),
      'dev/version-control/inventory/compute-bridge-write-inventory.json',
    );
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
      entries: Array<{ command: string; wrapper: string; source: string }>;
    };
    const unclassified = inventory.entries
      .map((entry) => ({
        entry,
        classification: classifyWriteOperation(entry.command, invocationFromWrapper(entry.wrapper)),
      }))
      .filter(({ classification }) => !classification)
      .map(({ entry }) => entry);

    expect(unclassified).toEqual([]);
    expect(classifyWriteOperation('compute_set_cell')).toMatchObject({
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
      domainClass: 'authored',
    });
    expect(classifyWriteOperation('compute_apply_sync_update', 'system-mutation')).toMatchObject({
      capturePolicy: 'excluded',
      writeAdmissionMode: 'captureDisabledNoHistory',
      operationKind: 'sync-import',
    });
    expect(classifyWriteOperation('compute_init', 'lifecycle')).toMatchObject({
      capturePolicy: 'rootCreation',
      writeAdmissionMode: 'capture',
    });
    expect(classifyWriteOperation('compute_destroy', 'lifecycle')).toMatchObject({
      capturePolicy: 'excluded',
      writeAdmissionMode: 'captureDisabledNoHistory',
    });
    expect(classifyWriteOperation('compute_undo')).toMatchObject({
      capturePolicy: 'historyGap',
      writeAdmissionMode: 'captureSuspendedWithGap',
    });
    expect(classifyWriteOperation('compute_update_viewport_bounds')).toMatchObject({
      capturePolicy: 'shadowOnly',
      writeAdmissionMode: 'shadowOnly',
    });
    expect(classifyWriteOperation('compute_set_custom_setting')).toMatchObject({
      capturePolicy: 'shadowOnly',
      writeAdmissionMode: 'shadowOnly',
      domainClass: 'transient',
    });
    expect(classifyWriteOperation('compute_wb_security_add_policy')).toMatchObject({
      capturePolicy: 'excluded',
      writeAdmissionMode: 'block',
      domainClass: 'secret',
    });
  });

  it('waits for all-sheet materialization before starting a public transport call', async () => {
    const materialized = deferred<void>();
    const awaitMaterialized = jest.fn(() => materialized.promise);
    const ctx = makeMockContext({ awaitMaterialized } as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(ctx, transport);

    const promise = core.mutatePublic(
      'compute_set_cell',
      () =>
        transport.call('compute_set_cell', { docId: 'test-doc' }) as Promise<
          [Uint8Array, MutationResult]
        >,
    );

    await Promise.resolve();

    expect(awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(transport.call).not.toHaveBeenCalled();

    materialized.resolve();
    await promise;

    expect(transport.call).toHaveBeenCalledWith('compute_set_cell', { docId: 'test-doc' });
  });

  it('does not hold undo and redo behind pending materialization', async () => {
    const materialized = deferred<void>();
    const awaitMaterialized = jest.fn(() => materialized.promise);
    const ctx = makeMockContext({ awaitMaterialized } as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(ctx, transport);

    await expect(core.undo()).resolves.toEqual(expect.any(Object));
    await expect(core.redo()).resolves.toEqual(expect.any(Object));

    expect(awaitMaterialized).not.toHaveBeenCalled();
    expect(transport.call).toHaveBeenCalledWith('compute_undo', { docId: 'test-doc' });
    expect(transport.call).toHaveBeenCalledWith('compute_redo', { docId: 'test-doc' });
  });

  it('records missing context diagnostics for production public wrappers', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const ctx = makeMockContext({
      versioningAdmissionDiagnostics: {
        record: (diagnostic: MutationAdmissionDiagnostic) => diagnostics.push(diagnostic),
      },
    } as unknown as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(ctx, transport);

    await core.mutatePublic(
      'compute_set_cell',
      () =>
        transport.call('compute_set_cell', { docId: 'test-doc' }) as Promise<
          [Uint8Array, MutationResult]
        >,
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'versioning.admission.missing-context',
        severity: 'warning',
        command: 'compute_set_cell',
        classification: expect.objectContaining({
          capturePolicy: 'commitEligible',
          writeAdmissionMode: 'capture',
        }),
      }),
    ]);
  });

  it('records public mutation results to the version mutation capture sink', async () => {
    const recordMutationResult = jest.fn();
    const ctx = makeMockContext({
      versioning: {
        mutationCapture: { recordMutationResult },
      },
    } as unknown as Partial<IKernelContext>);
    const result = mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-a1',
            sheetId: 'sheet-1',
            position: { row: 0, col: 0 },
            oldValue: null,
            value: 7,
            extraFlags: 0,
          },
        ],
        projectionChanges: [],
        errors: [],
        validationAnnotations: [],
        metrics: {},
      },
    });
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), result]),
    };
    const core = createStartedCore(ctx, transport);
    const operationContext = {
      operationId: 'operation-1',
      kind: 'mutation',
      author: { authorId: 'user-1', actorKind: 'user' },
      createdAt: '2026-06-20T00:00:00.000Z',
      domainIds: ['cell'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    };

    await core.mutatePublic(
      'compute_batch_set_cells_by_position',
      () =>
        transport.call('compute_batch_set_cells_by_position', { docId: 'test-doc' }) as Promise<
          [Uint8Array, MutationResult]
        >,
      [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      { operationContext: operationContext as any },
    );

    expect(recordMutationResult).toHaveBeenCalledWith({
      operation: 'compute_batch_set_cells_by_position',
      result,
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      operationContext,
    });
  });

  it('does not record contextless shadow-only mutations to the semantic capture sink', async () => {
    const recordMutationResult = jest.fn();
    const ctx = makeMockContext({
      versioning: {
        mutationCapture: { recordMutationResult },
      },
    } as unknown as Partial<IKernelContext>);
    const result = mutationResult();
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), result]),
    };
    const core = createStartedCore(ctx, transport);

    await core.mutatePublic(
      'compute_set_scroll_position',
      () =>
        transport.call('compute_set_scroll_position', { docId: 'test-doc' }) as Promise<
          [Uint8Array, MutationResult]
        >,
    );

    expect(transport.call).toHaveBeenCalledWith('compute_set_scroll_position', {
      docId: 'test-doc',
    });
    expect(recordMutationResult).not.toHaveBeenCalled();
  });

  it('records direct edits for date and time bridge value writes', async () => {
    const recordMutationResult = jest.fn();
    const ctx = makeMockContext({
      versioning: {
        mutationCapture: { recordMutationResult },
      },
    } as unknown as Partial<IKernelContext>);
    const dateResult = mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-c2',
            sheetId: 'sheet-1',
            position: { row: 1, col: 2 },
            oldValue: null,
            value: 45291,
            extraFlags: 0,
          },
        ],
        projectionChanges: [],
        errors: [],
        validationAnnotations: [],
        metrics: {},
      },
    });
    const timeResult = mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-e4',
            sheetId: 'sheet-1',
            position: { row: 3, col: 4 },
            oldValue: null,
            value: 0.5,
            extraFlags: 0,
          },
        ],
        projectionChanges: [],
        errors: [],
        validationAnnotations: [],
        metrics: {},
      },
    });
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_get_range_schemas_for_sheet') return [];
        if (command === 'compute_get_all_column_schemas') return [];
        return [new Uint8Array(), command === 'compute_set_time_value' ? timeResult : dateResult];
      }),
    };
    const bridge = createStartedBridge(ctx, transport);
    const operationContext = {
      operationId: 'operation-1',
      kind: 'mutation',
      author: { authorId: 'user-1', actorKind: 'user' },
      createdAt: '2026-06-20T00:00:00.000Z',
      domainIds: ['cell'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    };

    await bridge.setDateValue(sheetId('sheet-1'), 1, 2, 2024, 1, 15, {
      operationContext: operationContext as any,
    });
    await bridge.setTimeValue(sheetId('sheet-1'), 3, 4, 12, 0, 0, {
      operationContext: operationContext as any,
    });

    expect(transport.call).toHaveBeenCalledWith('compute_set_date_value', {
      docId: 'test-doc',
      sheetId: 'sheet-1',
      row: 1,
      col: 2,
      year: 2024,
      month: 1,
      day: 15,
    });
    expect(transport.call).toHaveBeenCalledWith('compute_set_time_value', {
      docId: 'test-doc',
      sheetId: 'sheet-1',
      row: 3,
      col: 4,
      hours: 12,
      minutes: 0,
      seconds: 0,
    });
    expect(recordMutationResult).toHaveBeenNthCalledWith(1, {
      operation: 'compute_set_date_value',
      result: dateResult,
      directEdits: [{ sheetId: 'sheet-1', row: 1, col: 2 }],
      operationContext,
    });
    expect(recordMutationResult).toHaveBeenNthCalledWith(2, {
      operation: 'compute_set_time_value',
      result: timeResult,
      directEdits: [{ sheetId: 'sheet-1', row: 3, col: 4 }],
      operationContext,
    });
  });

  it('records operation context for tab color bridge writes', async () => {
    const recordMutationResult = jest.fn();
    const ctx = makeMockContext({
      versioning: {
        mutationCapture: { recordMutationResult },
      },
    } as unknown as Partial<IKernelContext>);
    const result = mutationResult({
      sheetChanges: [
        {
          sheetId: 'sheet-1',
          kind: 'Set',
          field: 'tabColor',
          oldColor: '#FF0000',
          color: '#00FF00',
        },
      ],
    });
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), result]),
    };
    const bridge = createStartedBridge(ctx, transport);
    const operationContext = {
      operationId: 'operation-1',
      kind: 'mutation',
      author: { authorId: 'user-1', actorKind: 'user' },
      createdAt: '2026-06-20T00:00:00.000Z',
      domainIds: ['sheets'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    };

    await bridge.setTabColor(sheetId('sheet-1'), '#00FF00', {
      operationContext: operationContext as any,
    });

    expect(transport.call).toHaveBeenCalledWith('compute_set_tab_color', {
      docId: 'test-doc',
      sheetId: 'sheet-1',
      color: '#00FF00',
    });
    expect(recordMutationResult).toHaveBeenCalledWith({
      operation: 'compute_set_tab_color',
      result,
      directEdits: undefined,
      operationContext,
    });
  });

  it('records direct edit ranges for range bridge writes', async () => {
    const recordMutationResult = jest.fn();
    const ctx = makeMockContext({
      versioning: {
        mutationCapture: { recordMutationResult },
      },
    } as unknown as Partial<IKernelContext>);
    const result = mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-a1',
            sheetId: 'sheet-1',
            position: { row: 0, col: 0 },
            oldValue: 1,
            value: null,
            extraFlags: 0,
          },
        ],
        projectionChanges: [],
        errors: [],
        validationAnnotations: [],
        metrics: {},
      },
    });
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), result]),
    };
    const bridge = createStartedBridge(ctx, transport);
    const operationContext = {
      operationId: 'operation-1',
      kind: 'mutation',
      author: { authorId: 'user-1', actorKind: 'user' },
      createdAt: '2026-06-20T00:00:00.000Z',
      domainIds: ['cells'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    };
    const directEditRanges = [
      { sheetId: 'sheet-1', startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
    ];

    await bridge.clearRangeByPosition(sheetId('sheet-1'), 0, 0, 1, 1, {
      operationContext: operationContext as any,
      directEditRanges,
    });

    expect(recordMutationResult).toHaveBeenCalledWith({
      operation: 'compute_clear_range_by_position',
      result,
      directEdits: undefined,
      directEditRanges,
      operationContext,
    });
  });

  it('derives exact direct edits for replaceAll range writes', async () => {
    const recordMutationResult = jest.fn();
    const ctx = makeMockContext({
      versioning: {
        mutationCapture: { recordMutationResult },
      },
    } as unknown as Partial<IKernelContext>);
    const result = mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-a1',
            sheetId: 'sheet-1',
            position: { row: 0, col: 0 },
            oldValue: 10,
            value: 15,
            extraFlags: 0,
          },
          {
            cellId: 'cell-b1-formula',
            sheetId: 'sheet-1',
            position: { row: 0, col: 1 },
            oldFormula: '=A1*2',
            newFormula: '=A1*2',
            oldValue: 20,
            value: 30,
            extraFlags: 0,
          },
          {
            cellId: 'cell-c1-outside-range',
            sheetId: 'sheet-1',
            position: { row: 0, col: 2 },
            oldValue: 'old',
            value: 'new',
            extraFlags: 0,
          },
        ],
        projectionChanges: [],
        errors: [],
        validationAnnotations: [],
        metrics: {},
      },
    });
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), result]),
    };
    const core = createStartedCore(ctx, transport);
    const operationContext = {
      operationId: 'operation-1',
      kind: 'mutation',
      author: { authorId: 'user-1', actorKind: 'user' },
      createdAt: '2026-06-20T00:00:00.000Z',
      domainIds: ['cells'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    };
    const directEditRanges = [
      { sheetId: 'sheet-1', startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
    ];

    await core.mutatePublic(
      'compute_replace_all_in_range',
      () =>
        transport.call('compute_replace_all_in_range', { docId: 'test-doc' }) as Promise<
          [Uint8Array, MutationResult]
        >,
      undefined,
      {
        operationContext: operationContext as any,
        directEditRanges,
      },
    );

    expect(recordMutationResult).toHaveBeenCalledWith({
      operation: 'compute_replace_all_in_range',
      result,
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      directEditRanges,
      operationContext,
    });
  });

  it('rejects unclassified writes before transport execution', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const ctx = makeMockContext({
      versioningAdmissionDiagnostics: {
        record: (diagnostic: MutationAdmissionDiagnostic) => diagnostics.push(diagnostic),
      },
    } as unknown as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(ctx, transport);

    await expect(
      core.mutatePublic(
        'custom_unregistered_write',
        () =>
          transport.call('custom_unregistered_write', { docId: 'test-doc' }) as Promise<
            [Uint8Array, MutationResult]
          >,
      ),
    ).rejects.toThrow(
      "No VC-02 operation classification registered for 'custom_unregistered_write'.",
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'versioning.admission.unclassified-write',
        severity: 'error',
        command: 'custom_unregistered_write',
      }),
    ]);
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('rechecks the write gate after materialization before starting public transport', async () => {
    const materialized = deferred<void>();
    const ctx = makeMockContext({
      awaitMaterialized: jest.fn(() => materialized.promise),
    } as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(ctx, transport);
    const gate = new WriteGate();
    core.setWriteGate(gate);

    const promise = core.mutatePublic(
      'compute_set_cell',
      () =>
        transport.call('compute_set_cell', { docId: 'test-doc' }) as Promise<
          [Uint8Array, MutationResult]
        >,
    );
    await Promise.resolve();

    gate.enterClosing();
    materialized.resolve();

    await expect(promise).rejects.toThrow("document is in 'closing' mode");
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('lets system mutations bypass materialization and closing-mode public admission', async () => {
    const awaitMaterialized = jest.fn(async () => undefined);
    const ctx = makeMockContext({ awaitMaterialized } as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(ctx, transport);
    const gate = new WriteGate();
    gate.enterClosing();
    core.setWriteGate(gate);

    await core.mutateSystem(
      'compute_complete_deferred_hydration',
      () =>
        transport.call('compute_complete_deferred_hydration', { docId: 'test-doc' }) as Promise<
          [Uint8Array, MutationResult]
        >,
    );

    expect(awaitMaterialized).not.toHaveBeenCalled();
    expect(transport.call).toHaveBeenCalledWith('compute_complete_deferred_hydration', {
      docId: 'test-doc',
    });
    expect(gate.bypassDepth).toBe(0);
  });

  it('lets UI-state workbook settings patch without waiting for all sheets', async () => {
    const materialized = deferred<void>();
    const awaitMaterialized = jest.fn(() => materialized.promise);
    const ctx = makeMockContext({ awaitMaterialized } as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const bridge = createStartedBridge(ctx, transport);

    await bridge.patchWorkbookSettings({ selectedSheetIds: ['sheet-a'] });

    expect(awaitMaterialized).not.toHaveBeenCalled();
    expect(transport.call).toHaveBeenCalledWith('compute_patch_workbook_settings', {
      docId: 'test-doc',
      patch: { selectedSheetIds: ['sheet-a'] },
    });
  });

  it('passes pivot sheet insertion options through the handwritten transport call', async () => {
    const ctx = makeMockContext();
    const pivotConfig = {
      id: 'pivot-1',
      name: 'SalesPivot',
      fields: [],
      placements: [],
      filters: [],
    };
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => ['sheet-created', pivotConfig, mutationResult()]),
    };
    const bridge = createStartedBridge(ctx, transport);

    await bridge.pivotCreateWithSheet('Pivot Output', pivotConfig, {
      insertBeforeSheetId: sheetId('source-sheet'),
    });

    expect(transport.call).toHaveBeenCalledWith('compute_pivot_create_with_sheet', {
      docId: 'test-doc',
      sheetName: 'Pivot Output',
      config: pivotConfig,
      options: { insertBeforeSheetId: 'source-sheet' },
    });

    transport.call.mockClear();
    await bridge.pivotCreateWithSheet('Pivot Output', pivotConfig);

    expect(transport.call).toHaveBeenCalledWith('compute_pivot_create_with_sheet', {
      docId: 'test-doc',
      sheetName: 'Pivot Output',
      config: pivotConfig,
      options: null,
    });
  });

  it('materializes pivots through public admission without recording an undo mutation', async () => {
    const materialized = deferred<void>();
    const awaitMaterialized = jest.fn(() => materialized.promise);
    const notifyForwardMutation = jest.fn(async () => undefined);
    const ctx = makeMockContext({
      awaitMaterialized,
      services: {
        undo: {
          notifyForwardMutation,
        },
      },
    } as Partial<IKernelContext>);
    const pivotResult = {
      rows: [],
      columnHeaders: [],
      grandTotals: {},
      sourceRowCount: 0,
      renderedBounds: {
        totalRows: 1,
        totalCols: 1,
        firstDataRow: 0,
        firstDataCol: 0,
        numDataRows: 0,
        numDataCols: 0,
      },
    };
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_pivot_materialize_mutation') {
          return [new Uint8Array(), mutationResult({ data: pivotResult } as any)];
        }
        if (command === 'compute_drain_pending_updates') return [];
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(ctx, transport);

    const promise = bridge.pivotMaterialize(sheetId('sheet-1'), 'pivot-1', {
      expandedRows: {},
      expandedColumns: {},
    });
    await Promise.resolve();

    expect(awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(transport.call).not.toHaveBeenCalled();

    materialized.resolve();
    await expect(promise).resolves.toEqual(pivotResult);

    expect(transport.call).toHaveBeenCalledWith('compute_pivot_materialize_mutation', {
      docId: 'test-doc',
      sheetId: 'sheet-1',
      pivotId: 'pivot-1',
      expansionState: {
        expandedRows: {},
        expandedColumns: {},
      },
    });
    expect(notifyForwardMutation).not.toHaveBeenCalled();
  });

  it('updates and materializes pivots through one public undo mutation', async () => {
    const materialized = deferred<void>();
    const awaitMaterialized = jest.fn(() => materialized.promise);
    const notifyForwardMutation = jest.fn(async () => undefined);
    const ctx = makeMockContext({
      awaitMaterialized,
      services: {
        undo: {
          notifyForwardMutation,
        },
      },
    } as Partial<IKernelContext>);
    const pivotConfig = {
      id: 'pivot-1',
      name: 'SalesPivot',
      fields: [],
      placements: [
        { placementId: 'row:Category:0', fieldId: 'Category', area: 'row', position: 0 },
      ],
      filters: [],
    };
    const pivotResult = {
      rows: [],
      columnHeaders: [],
      grandTotals: {},
      sourceRowCount: 0,
      renderedBounds: {
        totalRows: 1,
        totalCols: 1,
        firstDataRow: 0,
        firstDataCol: 0,
        numDataRows: 0,
        numDataCols: 0,
      },
    };
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_pivot_update_and_materialize') {
          return [
            new Uint8Array(),
            mutationResult({ data: { config: pivotConfig, result: pivotResult } } as any),
          ];
        }
        if (command === 'compute_drain_pending_updates') return [];
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(ctx, transport);

    const promise = bridge.pivotUpdateAndMaterialize(sheetId('sheet-1'), 'pivot-1', pivotConfig, {
      expandedRows: {},
      expandedColumns: {},
    });
    await Promise.resolve();

    expect(awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(transport.call).not.toHaveBeenCalled();

    materialized.resolve();
    await expect(promise).resolves.toEqual({ config: pivotConfig, result: pivotResult });

    expect(transport.call).toHaveBeenCalledWith('compute_pivot_update_and_materialize', {
      docId: 'test-doc',
      sheetId: 'sheet-1',
      pivotId: 'pivot-1',
      config: pivotConfig,
      expansionState: {
        expandedRows: {},
        expandedColumns: {},
      },
    });
    expect(notifyForwardMutation).toHaveBeenCalledTimes(1);
  });

  it('keeps non-UI workbook settings behind the all-sheet materialization barrier', async () => {
    const materialized = deferred<void>();
    const awaitMaterialized = jest.fn(() => materialized.promise);
    const ctx = makeMockContext({ awaitMaterialized } as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const bridge = createStartedBridge(ctx, transport);

    const promise = bridge.patchWorkbookSettings({ culture: 'de-DE' });
    await Promise.resolve();

    expect(awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(transport.call).not.toHaveBeenCalled();

    materialized.resolve();
    await promise;

    expect(transport.call).toHaveBeenCalledWith('compute_patch_workbook_settings', {
      docId: 'test-doc',
      patch: { culture: 'de-DE' },
    });
  });

  it('does not begin compound removeSheet mutation before materialization', async () => {
    const materialized = deferred<void>();
    const awaitMaterialized = jest.fn(() => materialized.promise);
    const ctx = makeMockContext({ awaitMaterialized } as Partial<IKernelContext>);
    const calls: string[] = [];
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        calls.push(command);
        if (command === 'compute_begin_undo_group') return undefined;
        if (command === 'compute_delete_sheet') return [new Uint8Array(), mutationResult()];
        if (command === 'compute_get_sheet_order') return [];
        if (command === 'compute_end_undo_group') return undefined;
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(ctx, transport);
    const operationContext = {
      operationId: 'operation-delete-sheet',
      kind: 'mutation',
      author: { authorId: 'user-1', actorKind: 'user' },
      createdAt: '2026-06-20T00:00:00.000Z',
      sheetIds: ['sheet-delete'],
      domainIds: ['sheets'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    };

    const promise = bridge.removeSheet(sheetId('sheet-delete'), {
      operationContext: operationContext as any,
    });
    await Promise.resolve();

    expect(awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(calls).toEqual([]);

    materialized.resolve();
    await promise;

    expect(calls.slice(0, 2)).toEqual(['compute_begin_undo_group', 'compute_delete_sheet']);
  });

  it('refreshes undo state after closing an undo group', async () => {
    const notifyForwardMutation = jest.fn(async () => undefined);
    const ctx = makeMockContext({
      services: {
        undo: {
          notifyForwardMutation,
        },
      },
    } as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_end_undo_group') return undefined;
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const core = createStartedCore(ctx, transport);

    await core.endUndoGroup();

    expect(transport.call).toHaveBeenCalledWith('compute_end_undo_group', { docId: 'test-doc' });
    expect(notifyForwardMutation).toHaveBeenCalledTimes(1);
  });

  it('defers forward-mutation undo notifications while an undo group is open', async () => {
    const notifyForwardMutation = jest.fn(async () => undefined);
    const ctx = makeMockContext({
      services: {
        undo: {
          notifyForwardMutation,
        },
      },
    } as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_begin_undo_group') return undefined;
        if (command === 'compute_end_undo_group') return undefined;
        if (command === 'compute_set_cell') return [new Uint8Array(), mutationResult()];
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const core = createStartedCore(ctx, transport);

    await core.beginUndoGroup();
    await core.mutatePublic(
      'compute_set_cell',
      () =>
        transport.call('compute_set_cell', { docId: 'test-doc' }) as Promise<
          [Uint8Array, MutationResult]
        >,
    );

    expect(notifyForwardMutation).not.toHaveBeenCalled();

    await core.endUndoGroup();

    expect(notifyForwardMutation).toHaveBeenCalledTimes(1);
  });
});
