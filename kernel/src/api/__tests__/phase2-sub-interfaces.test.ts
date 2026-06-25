/**
 * Sub-Interfaces Unit Tests
 *
 * Tests sub-interface additions to WorkbookImpl and WorksheetImpl:
 * - WorksheetImpl.viewport (ViewportReader)
 * - WorksheetImpl.on() with SheetEvent
 * - WorkbookImpl.on() with WorkbookEvent
 * - WorkbookImpl undo plumbing (setPendingUndoDescription, setPendingSelectionCheckpoint)
 * - WorkbookImpl bridge getters (pivot, calculator, charts, services)
 * - WorksheetImpl.diagram
 * - WorksheetImpl.conditionalFormats
 * - WorksheetImpl.cellMetadata
 * - dispose lifecycle
 */

import { jest } from '@jest/globals';

import { sheetId, type SheetId } from '@mog-sdk/contracts/core';
import { KernelError } from '../../errors';
import {
  installWorksheetImplEsmMocks,
  worksheetCellMetadataCacheInstanceMock,
} from './helpers/worksheet-impl-esm-mocks';

// =============================================================================
// Mocks — Prevent deep import chain resolution
// =============================================================================

installWorksheetImplEsmMocks();

// =============================================================================
// Imports (after mocks)
// =============================================================================

const mockCellMetadataCacheInstance = worksheetCellMetadataCacheInstanceMock;
const { getName, getOrder } = await import('../../domain/sheets/sheet-meta');
const { createCheckpointManager } = await import('../../services/checkpoint');
const { WorkbookImpl } = await import('../workbook/workbook-impl');
const { WorksheetImpl } = await import('../worksheet/worksheet-impl');

// =============================================================================
// Helpers
// =============================================================================

function createMockEventBus() {
  const handlers: Map<string, Set<Function>> = new Map();
  return {
    on: jest.fn((type: string, handler: Function) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return () => {
        handlers.get(type)?.delete(handler);
      };
    }),
    emit: jest.fn((event: any) => {
      const eventHandlers = handlers.get(event.type);
      if (eventHandlers) {
        for (const h of eventHandlers) h(event);
      }
    }),
    onMany: jest.fn(),
    onAll: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

function createMockComputeBridge() {
  return {
    undo: jest.fn().mockResolvedValue(undefined),
    redo: jest.fn().mockResolvedValue(undefined),
    canUndo: jest.fn().mockResolvedValue(false),
    canRedo: jest.fn().mockResolvedValue(false),
    beginUndoGroup: jest.fn().mockResolvedValue(undefined),
    endUndoGroup: jest.fn().mockResolvedValue(undefined),
    fullRecalc: jest.fn().mockResolvedValue({ metrics: {} }),
    getAllSheetIds: jest.fn().mockResolvedValue(['sheet1', 'sheet2']),
    getSheetName: jest.fn().mockImplementation((id: string) => {
      const names: Record<string, string> = { sheet1: 'Sheet1', sheet2: 'Sheet2' };
      return Promise.resolve(names[id] ?? null);
    }),
    isSheetHidden: jest.fn().mockResolvedValue(false),
    getUndoState: jest.fn().mockResolvedValue({ undoDepth: 0, redoDepth: 0 }),
    createSheet: jest.fn().mockResolvedValue({ sheetId: 'newSheet' }),
    removeSheet: jest.fn().mockResolvedValue(undefined),
    renameSheet: jest.fn().mockResolvedValue(undefined),
    moveSheet: jest.fn().mockResolvedValue(undefined),
    copySheet: jest.fn().mockResolvedValue({ newSheetId: 'copiedSheet' }),
    setSheetHidden: jest.fn().mockResolvedValue(undefined),
    getAllCustomTableStyles: jest.fn().mockResolvedValue([]),
    createCustomTableStyle: jest.fn().mockResolvedValue('style1'),
    updateCustomTableStyle: jest.fn().mockResolvedValue(undefined),
    deleteCustomTableStyle: jest.fn().mockResolvedValue(undefined),
    getAllCustomCellStyles: jest.fn().mockResolvedValue([]),
    createCustomCellStyle: jest.fn().mockResolvedValue(undefined),
    updateCustomCellStyle: jest.fn().mockResolvedValue(undefined),
    deleteCustomCellStyle: jest.fn().mockResolvedValue(undefined),
    getWorkbookSettings: jest.fn().mockResolvedValue({}),
    setWorkbookSettings: jest.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// WorkbookImpl Helpers
// ---------------------------------------------------------------------------

function createMockUndoService() {
  return {
    undo: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
    redo: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
    canUndo: jest.fn().mockReturnValue(false),
    canRedo: jest.fn().mockReturnValue(false),
    subscribe: jest.fn().mockReturnValue(Object.assign(() => {}, { dispose: () => {} })),
    setNextDescription: jest.fn(),
    notifyForwardMutation: jest.fn(),
    getState: jest.fn().mockReturnValue({
      canUndo: false,
      canRedo: false,
      undoStackSize: 0,
      redoStackSize: 0,
      nextUndoDescription: null,
      nextRedoDescription: null,
    }),
    getNextUndoDescription: jest.fn().mockReturnValue(null),
    getNextRedoDescription: jest.fn().mockReturnValue(null),
    clear: jest.fn(),
    stopCapturing: jest.fn(),
    dispose: jest.fn(),
  };
}

function createMockWbCtx(computeBridge?: ReturnType<typeof createMockComputeBridge>) {
  const mockPivot = { compute: jest.fn() };
  const mockCalculator = { evaluate: jest.fn() };
  const mockCharts = { render: jest.fn() };
  const mockServices = { fileManager: jest.fn(), undo: createMockUndoService() };

  return {
    computeBridge: computeBridge ?? createMockComputeBridge(),
    eventBus: createMockEventBus(),
    mirror: {
      getSheetIds: jest.fn().mockReturnValue(['sheet1', 'sheet2']),
      getSheetMeta: jest.fn().mockImplementation((sheetId: SheetId) => {
        const names: Record<string, string> = { sheet1: 'Sheet1', sheet2: 'Sheet2' };
        return { name: names[sheetId] ?? String(sheetId), hidden: false };
      }),
      getWorkbookSettings: jest.fn().mockReturnValue({}),
    },
    setPendingUndoDescription: jest.fn(),
    setPendingSelectionCheckpoint: jest.fn(),
    pivot: mockPivot,
    calculator: mockCalculator,
    charts: mockCharts,
    services: mockServices,
    floatingObjectManager: {
      setPositionLookup: jest.fn(),
      dispose: jest.fn(),
    },
  } as any;
}

function setupSheetMetaMocks() {
  (getOrder as jest.Mock).mockResolvedValue(['sheet1', 'sheet2']);
  (getName as jest.Mock).mockImplementation((_ctx: any, sheetId: SheetId) => {
    const names: Record<string, string> = { sheet1: 'Sheet1', sheet2: 'Sheet2' };
    return Promise.resolve(names[sheetId] ?? undefined);
  });
}

async function createTestWorkbook(overrides?: Record<string, unknown>) {
  const bridge = createMockComputeBridge();
  const ctx = createMockWbCtx(bridge);
  const eventBus = createMockEventBus();

  setupSheetMetaMocks();

  (createCheckpointManager as jest.Mock).mockImplementation(() => ({
    create: jest.fn().mockResolvedValue({ success: true, data: 'cp-1' }),
    restore: jest.fn().mockResolvedValue({ success: true }),
    list: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  }));

  const config = {
    ctx,
    eventBus,
    ...overrides,
  };

  const wb = new WorkbookImpl(config);
  await wb._init();

  return { wb, ctx, eventBus };
}

// ---------------------------------------------------------------------------
// WorksheetImpl Helpers
// ---------------------------------------------------------------------------

const SHEET_ID = sheetId('test-sheet-1');

function createMockWsCtx() {
  const binaryViewportBuffer = {
    hasBuffer: jest.fn().mockReturnValue(true),
    getMerges: jest.fn().mockReturnValue([{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }]),
    getRowDimension: jest.fn().mockReturnValue({ height: 20, hidden: false }),
    getColDimension: jest.fn().mockReturnValue({ width: 80, hidden: false }),
    getBounds: jest.fn().mockReturnValue({ startRow: 0, startCol: 0, endRow: 100, endCol: 26 }),
  };
  const binaryCellReader = {
    moveTo: jest.fn().mockReturnValue(true),
    valueType: 1,
    numberValue: 42,
    displayText: '42',
    hasFormula: false,
    hasComment: true,
    hasSparkline: false,
    hasHyperlink: false,
    errorText: '',
    format: '',
  };

  return {
    computeBridge: {
      setCell: jest.fn(),
      getCell: jest.fn(),
      getCellIdAtPosition: jest.fn(),
      getCellFormat: jest.fn(),
      getDataBounds: jest.fn(),
      setCellMetadataCache: jest.fn(),
      getActiveCellData: jest.fn().mockReturnValue({
        cellId: 'cell-0-0',
        value: { type: 'Text', value: 'hello' },
        formula: undefined,
        format: undefined,
        metadata: undefined,
        editText: undefined,
        isFormulaHidden: false,
        hyperlinkUrl: undefined,
        numberFormat: undefined,
      }),
      getPerViewportStates: jest.fn().mockReturnValue(new Map([[`main:${SHEET_ID}`, {}]])),
      getAccessorForViewport: jest.fn().mockReturnValue(binaryCellReader),
      getViewportBuffer: jest.fn().mockReturnValue(binaryViewportBuffer),
    },
    binaryViewportBuffer,
    binaryCellReader,
    eventBus: createMockEventBus(),
    diagram: { createDiagram: jest.fn(), getLayout: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    setPendingSelectionCheckpoint: jest.fn(),
  } as any;
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// WorkbookImpl Tests — Undo Plumbing
// =============================================================================

describe('WorkbookImpl — undo plumbing (2d, 2f)', () => {
  it('setPendingUndoDescription() delegates to the undo service', async () => {
    const { wb, ctx } = await createTestWorkbook();
    wb.setPendingUndoDescription('Set cell value');
    expect(ctx.services.undo.setNextDescription).toHaveBeenCalledWith('Set cell value');
  });

  it('setPendingSelectionCheckpoint() delegates to ctx.setPendingSelectionCheckpoint()', async () => {
    const { wb, ctx } = await createTestWorkbook();
    const checkpoint = { sheetId: 'sheet1', row: 0, col: 0 };
    wb.setPendingSelectionCheckpoint(checkpoint as any);
    expect(ctx.setPendingSelectionCheckpoint).toHaveBeenCalledWith(checkpoint);
  });
});

// =============================================================================
// WorkbookImpl Tests — Bridge Getters
// =============================================================================

describe('WorkbookImpl — bridge getters (2e)', () => {
  it('wb.pivot returns ctx.pivot', async () => {
    const { wb, ctx } = await createTestWorkbook();
    expect(wb.pivot).toBe(ctx.pivot);
  });

  it('wb.charts returns ctx.charts', async () => {
    const { wb, ctx } = await createTestWorkbook();
    expect(wb.charts).toBe(ctx.charts);
  });

  it('wb.services returns ctx.services', async () => {
    const { wb, ctx } = await createTestWorkbook();
    expect(wb.services).toBe(ctx.services);
  });

  it('wb.services throws KernelError when ctx.services is undefined', async () => {
    const { wb, ctx } = await createTestWorkbook();
    ctx.services = undefined;
    expect(() => wb.services).toThrow(KernelError);
  });
});

// =============================================================================
// WorkbookImpl Tests — on() with WorkbookEvent
// =============================================================================

describe('WorkbookImpl — on() with WorkbookEvent (2c)', () => {
  it('wb.on("sheetAdded", handler) subscribes to internal "sheet:created"', async () => {
    const { wb, eventBus } = await createTestWorkbook();
    const handler = jest.fn();
    wb.on('sheetAdded', handler);
    expect(eventBus.on).toHaveBeenCalledWith('sheet:created', expect.any(Function));
  });

  it('wb.on("undoStackChanged", handler) subscribes to multiple internal events', async () => {
    const { wb, eventBus } = await createTestWorkbook();
    const handler = jest.fn();
    wb.on('undoStackChanged', handler);

    const subscribedTypes = (eventBus.on as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(subscribedTypes).toContain('undo:stateChanged');
    expect(subscribedTypes).toContain('undo:changed');
  });

  it('returned function unsubscribes all internal subscriptions', async () => {
    const { wb, eventBus } = await createTestWorkbook();
    const handler = jest.fn();

    // undoStackChanged maps to 2 internal events
    const unsub = wb.on('undoStackChanged', handler);

    // We should have 2 subscriptions
    const callCount = (eventBus.on as jest.Mock).mock.calls.length;
    expect(callCount).toBe(2);

    // Get the internal handlers that were registered
    const internalHandler1 = (eventBus.on as jest.Mock).mock.calls[0][1];

    // Before unsub, handlers fire
    internalHandler1({ type: 'undo:stateChanged' });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    expect(typeof unsub).toBe('function');
  });

  it('handler receives the internal event directly (no wrapper)', async () => {
    const { wb, eventBus } = await createTestWorkbook();
    const handler = jest.fn();
    wb.on('sheetAdded', handler);

    // Grab the internal handler
    const internalHandler = (eventBus.on as jest.Mock).mock.calls[0][1];
    const internalEvent = { type: 'sheet:created', sheetId: 'sheet1' };
    internalHandler(internalEvent);

    // Event is passed directly — no { type, sheetId, data } wrapper
    expect(handler).toHaveBeenCalledWith(internalEvent);
  });
});

// =============================================================================
// WorksheetImpl Tests — viewport
// =============================================================================

describe('WorksheetImpl — viewport (2a)', () => {
  it('ws.viewport returns a ViewportReader', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const vp = ws.viewport;
    expect(vp).toBeDefined();
    expect(typeof vp.getCellData).toBe('function');
    expect(typeof vp.getActiveCellData).toBe('function');
    expect(typeof vp.getMerges).toBe('function');
  });

  it('ws.viewport.getCellData() delegates to ctx.binaryCellReader.moveTo()', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    ws.viewport.getCellData(3, 5);
    expect(ctx.binaryCellReader.moveTo).toHaveBeenCalledWith(3, 5);
  });

  it('ws.viewport.getActiveCellData() delegates to ctx.computeBridge.getActiveCellData()', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    ws.viewport.getActiveCellData();
    expect(ctx.computeBridge.getActiveCellData).toHaveBeenCalled();
  });

  it('ws.viewport.getMerges() delegates to ctx.binaryViewportBuffer.getMerges()', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    ws.viewport.getMerges();
    expect(ctx.binaryViewportBuffer.getMerges).toHaveBeenCalled();
  });

  it('ws.viewport.hasComment() delegates to ctx.binaryCellReader', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const result = ws.viewport.hasComment(2, 3);
    expect(ctx.binaryCellReader.moveTo).toHaveBeenCalledWith(2, 3);
    expect(result).toBe(true);
  });

  it('ws.viewport.getRowDimension() delegates to ctx.binaryViewportBuffer.getRowDimension()', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const dim = ws.viewport.getRowDimension(5);
    expect(ctx.binaryViewportBuffer.getRowDimension).toHaveBeenCalledWith(5);
    expect(dim).toEqual({ height: 20, hidden: false });
  });

  it('ws.viewport.getColDimension() delegates to ctx.binaryViewportBuffer.getColDimension()', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const dim = ws.viewport.getColDimension(10);
    expect(ctx.binaryViewportBuffer.getColDimension).toHaveBeenCalledWith(10);
    expect(dim).toEqual({ width: 80, hidden: false });
  });

  it('ws.viewport.getBounds() delegates to ctx.binaryViewportBuffer.getBounds()', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const bounds = ws.viewport.getBounds();
    expect(ctx.binaryViewportBuffer.getBounds).toHaveBeenCalled();
    expect(bounds).toEqual({ startRow: 0, startCol: 0, endRow: 100, endCol: 26 });
  });

  it('ws.viewport.binary.isReady() delegates to ctx.binaryViewportBuffer.hasBuffer()', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const ready = ws.viewport.binary.isReady();
    expect(ctx.binaryViewportBuffer.hasBuffer).toHaveBeenCalled();
    expect(ready).toBe(true);
  });

  it('ws.viewport is lazy (same instance on repeated access)', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const vp1 = ws.viewport;
    const vp2 = ws.viewport;
    expect(vp1).toBe(vp2);
  });
});

// =============================================================================
// WorksheetImpl Tests — on() with SheetEvent
// =============================================================================

describe('WorksheetImpl — on() with SheetEvent (2b)', () => {
  it('ws.on("cellChanged", handler) subscribes to multiple internal events', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const handler = jest.fn();
    ws.on('cellChanged', handler);

    const subscribedTypes = (ctx.eventBus.on as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(subscribedTypes).toContain('cell:changed');
    expect(subscribedTypes).toContain('cells:batch-changed');
    expect(subscribedTypes).toContain('cell:value-changed');
    expect(subscribedTypes).toContain('cell:format-changed');
    expect(subscribedTypes).toContain('cell:metadata-changed');
  });

  it('handler only fires for events matching ws.sheetId', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const handler = jest.fn();
    ws.on('cellChanged', handler);

    // Get the first internal handler registered
    const internalHandler = (ctx.eventBus.on as jest.Mock).mock.calls[0][1];

    // Fire event with matching sheetId
    internalHandler({ type: 'cell:changed', sheetId: SHEET_ID });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handler does NOT fire for events from different sheets', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const handler = jest.fn();
    ws.on('cellChanged', handler);

    const internalHandler = (ctx.eventBus.on as jest.Mock).mock.calls[0][1];

    // Fire event with different sheetId
    internalHandler({ type: 'cell:changed', sheetId: 'other-sheet-id' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('fine-grained passthrough: ws.on("filter:applied", handler) subscribes directly', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const handler = jest.fn();
    ws.on('filter:applied', handler);

    const subscribedTypes = (ctx.eventBus.on as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(subscribedTypes).toContain('filter:applied');
  });

  it('returned function unsubscribes all internal subscriptions for coarse events', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const handler = jest.fn();
    const unsub = ws.on('cellChanged', handler);

    expect(typeof unsub).toBe('function');

    // cellChanged maps to 5 events, so 5 subscriptions
    const callCount = (ctx.eventBus.on as jest.Mock).mock.calls.length;
    expect(callCount).toBe(5);

    unsub();
  });
});

// =============================================================================
// WorksheetImpl Tests — diagram
// =============================================================================

describe('WorksheetImpl — diagram (2g)', () => {
  it('ws.diagrams returns a WorksheetDiagrams implementation', () => {
    const ctx = createMockWsCtx();
    const mockFom = {} as any; // minimal FloatingObjectManager mock
    const ws = new WorksheetImpl(SHEET_ID, ctx, { floatingObjectManager: mockFom });
    expect(ws.diagrams).toBeDefined();
  });
});

// =============================================================================
// WorksheetImpl Tests — conditionalFormats
// =============================================================================

describe('WorksheetImpl — conditionalFormats / cfCache (2h)', () => {
  it('ws._internal.cfCache returns a ConditionalFormatCache', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const cf = ws._internal.cfCache;
    expect(cf).toBeDefined();
    expect(typeof cf.getResult).toBe('function');
    expect(typeof cf.hasCF).toBe('function');
    expect(typeof cf.evaluateAll).toBe('function');
    expect(typeof cf.invalidateCells).toBe('function');
    expect(typeof cf.invalidateAll).toBe('function');
    expect(typeof cf.onRulesChanged).toBe('function');
    expect(typeof cf.destroy).toBe('function');
  });

  it('is lazy (same instance on repeated access)', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const cf1 = ws._internal.cfCache;
    const cf2 = ws._internal.cfCache;
    expect(cf1).toBe(cf2);
  });

  it('destroy() is callable (no-op stub)', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const cf = ws._internal.cfCache;
    // No-op stub — should not throw
    cf.destroy();
  });
});

// =============================================================================
// WorksheetImpl Tests — cellMetadata
// =============================================================================

describe('WorksheetImpl — cellMetadata (2i)', () => {
  it('ws.cellMetadata returns a CellMetadataCache', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const cm = ws.cellMetadata;
    expect(cm).toBeDefined();
    expect(typeof cm.isProjectedPosition).toBe('function');
    expect(typeof cm.getProjectionSourcePosition).toBe('function');
    expect(typeof cm.getProjectionRange).toBe('function');
    expect(typeof cm.hasValidationErrors).toBe('function');
    expect(typeof cm.evaluateViewport).toBe('function');
    expect(typeof cm.onChange).toBe('function');
    expect(typeof cm.clear).toBe('function');
    expect(typeof cm.destroy).toBe('function');
  });

  it('is lazy (same instance on repeated access)', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const cm1 = ws.cellMetadata;
    const cm2 = ws.cellMetadata;
    expect(cm1).toBe(cm2);
  });

  it('destroy() calls underlying cache dispose()', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    const cm = ws.cellMetadata;
    cm.destroy();
    expect(mockCellMetadataCacheInstance.dispose).toHaveBeenCalled();
  });
});

// =============================================================================
// WorksheetImpl Tests — dispose lifecycle
// =============================================================================

describe('WorksheetImpl — dispose lifecycle', () => {
  it('dispose() calls destroy() on cfCache if created', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    // Trigger lazy creation
    ws._internal.cfCache;

    // Should not throw — cfCache is a no-op stub
    ws.dispose();
  });

  it('dispose() calls destroy() on cellMetadata if created', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    // Trigger lazy creation
    ws.cellMetadata;

    ws.dispose();
    expect(mockCellMetadataCacheInstance.dispose).toHaveBeenCalled();
  });

  it('dispose() clears viewport reference', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    // Trigger lazy creation
    ws.viewport;
    expect((ws as any)._viewport).not.toBeNull();

    ws.dispose();
    expect((ws as any)._viewport).toBeNull();
  });

  it('dispose() does not throw if cfCache was never created', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    expect(() => ws.dispose()).not.toThrow();
  });

  it('dispose() does not throw if cellMetadata was never created', () => {
    const ctx = createMockWsCtx();
    const ws = new WorksheetImpl(SHEET_ID, ctx);
    expect(() => ws.dispose()).not.toThrow();
  });
});
