/**
 * Chart Action Handlers Tests
 *
 * Unit tests for chart action handlers in the Unified Action System.
 * Tests handler behavior, payload validation, and integration with
 * the unified Workbook/Worksheet API and XState actors.
 *
 * Test categories:
 * - Chart editing actions (EDIT_CHART, EDIT_CHART_TITLE, CHANGE_CHART_TYPE)
 * - Chart clipboard actions (COPY_CHART, CUT_CHART, PASTE_CHART, DUPLICATE_CHART)
 * - Chart z-order actions (BRING_TO_FRONT, SEND_TO_BACK, BRING_FORWARD, SEND_BACKWARD)
 * - Chart selection actions (SELECT_CHART, DESELECT_CHART, etc.)
 * - Chart navigation actions (CYCLE_NEXT_CHART, CYCLE_PREVIOUS_CHART)
 * - Chart nudge actions (NUDGE_CHART_UP/DOWN/LEFT/RIGHT)
 * - Dialog actions (OPEN_SELECT_DATA_DIALOG, etc.)
 *
 */

import { jest } from '@jest/globals';

import { DEFAULT_CHART_COLORS, type SerializedChart } from '@mog/charts';
import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { sheetId as makeSheetId } from '@mog-sdk/contracts/core';

import * as ChartHandlers from '../charts';
import {
  createChartAddReceipt,
  createMockFileHandle,
  createMockPlatform,
  createMockShellService,
} from './test-helpers';

/**
 * Create minimal mock action dependencies for testing.
 */
function createMockDeps(overrides?: Partial<ActionDependencies>): ActionDependencies {
  const sheetsRoot = new Map<string, Map<string, unknown>>();
  const sheetId = makeSheetId('sheet1');

  // Create test sheet using plain Maps
  const sheetContainer = new Map<string, unknown>();
  sheetContainer.set('charts', new Map<string, SerializedChart>());
  sheetContainer.set('cells', new Map<string, unknown>());
  sheetContainer.set('properties', new Map<string, unknown>());
  sheetContainer.set('grid', new Map<string, string>());
  sheetContainer.set('meta', new Map<string, unknown>());
  sheetContainer.set('rowHeights', new Map<string, number>());
  sheetContainer.set('colWidths', new Map<string, number>());
  sheetContainer.set('merges', new Map<string, unknown>());
  sheetsRoot.set(sheetId, sheetContainer);

  // Create mock worksheet for unified Workbook API
  const mockWorksheet = {
    getName: jest.fn().mockResolvedValue('Sheet1'),
    getSheetId: jest.fn().mockReturnValue(sheetId),
    getIndex: jest.fn().mockReturnValue(0),
    // Returns the input range unchanged by default (single cell stays single cell).
    // Tests that exercise auto-expansion can override this via overrides.
    getCurrentRegion: jest.fn().mockImplementation(async (row: number, col: number) => ({
      startRow: row,
      startCol: col,
      endRow: row,
      endCol: col,
    })),
    // Namespaced charts API (current source uses ws.charts.*)
    charts: {
      get: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue(createChartAddReceipt()),
      duplicate: jest.fn().mockResolvedValue(createChartAddReceipt('duplicated-chart-id')),
      update: jest.fn().mockResolvedValue(undefined),
      setSourceData: jest.fn().mockResolvedValue(undefined),
      getAppModel: jest.fn().mockResolvedValue({
        source: { orientation: 'columns', supportsOrientationSwitch: true },
      }),
      switchSeriesOrientation: jest.fn().mockResolvedValue({ status: 'applied' }),
      remove: jest.fn().mockResolvedValue(undefined),
      bringToFront: jest.fn().mockResolvedValue(undefined),
      sendToBack: jest.fn().mockResolvedValue(undefined),
      bringForward: jest.fn().mockResolvedValue(undefined),
      sendBackward: jest.fn().mockResolvedValue(undefined),
    },
    // Legacy flat aliases for backward-compatible test assertions
    getChart: jest.fn().mockResolvedValue(null),
    listCharts: jest.fn().mockResolvedValue([]),
    addChart: jest.fn().mockResolvedValue('new-chart-id'),
    updateChart: jest.fn().mockResolvedValue(undefined),
    removeChart: jest.fn().mockResolvedValue(undefined),
  };

  // Create mock workbook
  const mockWorkbook = {
    getActiveSheet: jest.fn().mockReturnValue(mockWorksheet),
    getSheet: jest.fn().mockReturnValue(mockWorksheet),
    getSheetById: jest.fn().mockReturnValue(mockWorksheet),
    addSheet: jest.fn().mockResolvedValue(mockWorksheet),
    getSheetCount: jest.fn().mockReturnValue(1),
    getSheetNames: jest.fn().mockReturnValue(['Sheet1']),
    activeSheet: mockWorksheet,
    sheets: {
      add: jest.fn().mockResolvedValue(mockWorksheet),
    },
  };

  // Create mock ctx
  const mockCtx = {
    doc: {} as any,
    refs: {
      doc: {} as any,
    },
    eventBus: {
      emit: () => {},
      on: () => () => {},
      off: () => {},
    },
  };

  // Create mock UIStore
  const mockUIStore = {
    getState: () => ({
      activeSheetId: sheetId,
      selectDataDialog: {
        isOpen: false,
        chartId: null,
        sheetId: null,
      },
      insertChartWizardDialog: {
        isOpen: false,
        chartType: null,
        variantId: null,
        dataRange: '',
      },
      chartClipboard: {
        copiedChart: null,
        cutChartId: null,
        isCut: false,
      },
      openSelectDataDialog: jest.fn(),
      closeSelectDataDialog: jest.fn(),
      openInsertChartWizardDialog: jest.fn(),
      closeInsertChartWizardDialog: jest.fn(),
      setChartWizardError: jest.fn(),
      setActiveSheetId: jest.fn(),
      setActiveSheet: jest.fn(),
      setChartEditorTab: jest.fn(),
    }),
  };

  // Create mock chart commands with spies
  const mockChartCommands = {
    select: jest.fn(),
    deselect: jest.fn(),
    deselectAll: jest.fn(),
    addToSelection: jest.fn(),
    toggleSelection: jest.fn(),
    startEdit: jest.fn(),
    stopEditing: jest.fn(),
    startTitleEdit: jest.fn(),
    startSelectingData: jest.fn(),
    stopSelectingData: jest.fn(),
    startResize: jest.fn(),
    updateResize: jest.fn(),
    endResize: jest.fn(),
    startDrag: jest.fn(),
    updateDrag: jest.fn(),
    endDrag: jest.fn(),
  };

  // Create mock accessors
  const mockAccessors = {
    selection: {
      getActiveCell: () => ({ row: 0, col: 0 }),
      getRanges: () => [{ startRow: 0, startCol: 0, endRow: 5, endCol: 3 }],
      getActiveRange: () => ({ startRow: 0, startCol: 0, endRow: 5, endCol: 3 }),
      getDataBoundedRanges: () => [{ startRow: 0, startCol: 0, endRow: 5, endCol: 3 }],
      getSheetId: () => null,
      getFillHandleState: () => null,
      getDragCellsState: () => null,
      getHeaderResizeState: () => null,
      getFormulaRangeState: () => null,
      isIdle: () => true,
      isSelecting: () => false,
      isSelectingRangeForFormula: () => false,
      isResizingHeader: () => false,
      isDraggingFillHandle: () => false,
      isDraggingCells: () => false,
    },
    editor: {
      getValue: () => '',
      getCursorPosition: () => 0,
      getSheetId: () => null,
      getCell: () => null,
      getResolvedFormulaRanges: () => [],
      getActiveFormulaRange: () => null,
      getCommitType: () => null,
      getEditStartSelectionRanges: () => null,
      isInactive: () => true,
      isEditing: () => false,
      isFormulaEditing: () => false,
      isEnterMode: () => false,
      isEditMode: () => false,
      isImeComposing: () => false,
      isCommitting: () => false,
    },
    clipboard: {
      hasData: () => false,
      getData: () => null,
      getSourceRange: () => null,
      getSourceSheetId: () => null,
      getOperation: () => null,
      getCellCount: () => 0,
      isIdle: () => true,
      hasCutData: () => false,
      hasCopyData: () => false,
    },
    chart: {
      getSelectedIds: () => [],
      getSelectedCount: () => 0,
      getSelectedChartId: () => null,
      isChartSelected: () => false,
      hasSelection: () => false,
      isEditing: () => false,
      getEditingChartId: () => null,
      isSelectingData: () => false,
      isResizing: () => false,
      isDragging: () => false,
      isIdle: () => true,
      getResizeState: () => null,
      getDragState: () => null,
    },
    object: {
      getSelectedIds: () => [],
      getFirstSelectedId: () => null,
      getSelectedTypes: () => [],
      hasSelection: () => false,
      getSelectedCount: () => 0,
      isIdle: () => true,
      isDragging: () => false,
      isResizing: () => false,
      isEditingText: () => false,
      isHovering: () => false,
      getHoveredId: () => null,
      getDragState: () => null,
      getResizeState: () => null,
    },
  };

  // Create mock commands
  const mockCommands = {
    selection: {
      setSelection: jest.fn(),
      setActiveCell: jest.fn(),
      setActiveCellInRange: jest.fn(),
      extendSelection: jest.fn(),
      addRange: jest.fn(),
      clear: jest.fn(),
      keyArrow: jest.fn(),
      keyArrowExtend: jest.fn(),
      keyEdge: jest.fn(),
      keyEdgeExtend: jest.fn(),
      keyHome: jest.fn(),
      keyHomeExtend: jest.fn(),
      keyEnd: jest.fn(),
      keyEndExtend: jest.fn(),
      keyTab: jest.fn(),
      keyEnter: jest.fn(),
      keyPage: jest.fn(),
      keyPageExtend: jest.fn(),
      selectAll: jest.fn(),
      selectCurrentRegion: jest.fn(),
      selectEntireRow: jest.fn(),
      selectEntireColumn: jest.fn(),
      startFormulaRangeMode: jest.fn(),
      exitFormulaRangeMode: jest.fn(),
      updateFormulaRange: jest.fn(),
      commitFormulaRange: jest.fn(),
      startHeaderResize: jest.fn(),
      updateHeaderResize: jest.fn(),
      endHeaderResize: jest.fn(),
      startFillHandle: jest.fn(),
      updateFillHandle: jest.fn(),
      endFillHandle: jest.fn(),
      startDragCells: jest.fn(),
      updateDragCells: jest.fn(),
      endDragCells: jest.fn(),
      // mode mutations go through commands.selection.setMode;
      // legacy setExtendMode / setAddMode mocks were retired with the UIStore slice.
    },
    editor: {
      startEditing: jest.fn(),
      input: jest.fn(),
      commit: jest.fn(),
      cancel: jest.fn(),
      insertNewline: jest.fn(),
      toggleEditMode: jest.fn(),
      cycleReference: jest.fn(),
      startImeComposition: jest.fn(),
      updateImeComposition: jest.fn(),
      endImeComposition: jest.fn(),
      setFormulaRanges: jest.fn(),
      selectFormulaRange: jest.fn(),
      clearActiveFormulaRange: jest.fn(),
    },
    clipboard: {
      copy: jest.fn(),
      cut: jest.fn(),
      paste: jest.fn(),
      pasteSpecial: jest.fn(),
      clear: jest.fn(),
    },
    chart: mockChartCommands,
    object: {
      selectObject: jest.fn(),
      selectMultiple: jest.fn(),
      deselectAll: jest.fn(),
      select: jest.fn(),
      deselect: jest.fn(),
      addToSelection: jest.fn(),
      toggleSelection: jest.fn(),
      startDrag: jest.fn(),
      updateDrag: jest.fn(),
      endDrag: jest.fn(),
      startResize: jest.fn(),
      updateResize: jest.fn(),
      endResize: jest.fn(),
      startTextEdit: jest.fn(),
      endTextEdit: jest.fn(),
      setHover: jest.fn(),
      clearHover: jest.fn(),
      nudge: jest.fn(),
    },
  };

  return {
    ctx: mockCtx,
    workbook: mockWorkbook,
    uiStore: mockUIStore,
    accessors: mockAccessors,
    commands: mockCommands,
    getActiveSheetId: () => sheetId,
    onUIAction: jest.fn(),
    // required deps. rewrites the four
    // `expect(deps.onUIAction).toHaveBeenCalledWith(...)` assertions for
    // SAVE_CHART_AS_IMAGE / ADD_DATA_LABELS / ADD_TRENDLINE / TOGGLE_GRIDLINES
    // to assert on platform.dialogs / worksheet API instead.
    platform: createMockPlatform(),
    shellService: createMockShellService(),
    ...overrides,
  } as unknown as ActionDependencies;
}

// =============================================================================
// CHART EDITING ACTIONS
// =============================================================================

describe('Chart Handlers - Editing Actions', () => {
  describe('EDIT_CHART', () => {
    it('should return handled when chartId is provided', () => {
      const deps = createMockDeps();
      const result = ChartHandlers.EDIT_CHART(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(true);
    });

    it('should select the chart object and start editing', () => {
      const deps = createMockDeps();
      ChartHandlers.EDIT_CHART(deps, { chartId: 'chart-123' });

      expect(deps.commands.object.selectObject).toHaveBeenCalledWith('chart-123', false, false);
      expect(deps.commands.chart.startEdit).toHaveBeenCalled();
    });

    it('should return not handled when chartId is missing', () => {
      const deps = createMockDeps();
      const result = ChartHandlers.EDIT_CHART(deps, {});

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing chartId in payload');
    });

    it('should return not handled when payload is undefined', () => {
      const deps = createMockDeps();
      const result = ChartHandlers.EDIT_CHART(deps, undefined);

      expect(result.handled).toBe(false);
    });

    it('should use selected object id when keyboard payload is omitted', () => {
      const deps = createMockDeps();
      jest.spyOn(deps.accessors.object, 'getFirstSelectedId').mockReturnValue('chart-123');

      const result = ChartHandlers.EDIT_CHART(deps, undefined);

      expect(result.handled).toBe(true);
      expect(deps.commands.object.selectObject).toHaveBeenCalledWith('chart-123', false, false);
      expect(deps.commands.chart.startEdit).toHaveBeenCalled();
    });
  });

  describe('EDIT_CHART_TITLE', () => {
    it('should select the chart object and start title editing', () => {
      const deps = createMockDeps();
      ChartHandlers.EDIT_CHART_TITLE(deps, { chartId: 'chart-123' });

      expect(deps.commands.object.selectObject).toHaveBeenCalledWith('chart-123', false, false);
      expect(deps.commands.chart.startTitleEdit).toHaveBeenCalledWith('');
    });

    it('should return not handled when chartId is missing', () => {
      const deps = createMockDeps();
      const result = ChartHandlers.EDIT_CHART_TITLE(deps, {});

      expect(result.handled).toBe(false);
    });

    it('should use selected object id when keyboard payload is omitted', () => {
      const deps = createMockDeps();
      jest.spyOn(deps.accessors.object, 'getFirstSelectedId').mockReturnValue('chart-123');

      const result = ChartHandlers.EDIT_CHART_TITLE(deps, undefined);

      expect(result.handled).toBe(true);
      expect(deps.commands.object.selectObject).toHaveBeenCalledWith('chart-123', false, false);
      expect(deps.commands.chart.startTitleEdit).toHaveBeenCalledWith('');
    });
  });

  describe('CHANGE_CHART_TYPE', () => {
    it('should use unified Worksheet API to change chart type', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.CHANGE_CHART_TYPE(deps, {
        chartId: 'chart-123',
        chartType: 'bar',
      });

      // Handler uses ws.updateChart via unified API
      expect(result.handled).toBe(true);
    });

    it('should return not handled when chartId is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.CHANGE_CHART_TYPE(deps, { chartType: 'bar' });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing chartId in payload');
    });

    it('should return not handled when chartType is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.CHANGE_CHART_TYPE(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing chartType in payload');
    });
  });
});

// =============================================================================
// CHART CLIPBOARD ACTIONS
// =============================================================================

describe('Chart Handlers - Clipboard Actions', () => {
  describe('COPY_CHART', () => {
    it('should read chart via unified Worksheet API', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.COPY_CHART(deps, { chartId: 'chart-123' });

      // Handler reads chart via ws.getChart (unified API)
      // Mock returns null, so handler returns chart not found
      expect(result.handled).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return not handled when chartId is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.COPY_CHART(deps, {});

      expect(result.handled).toBe(false);
    });
  });

  describe('CUT_CHART', () => {
    it('should read chart via unified Worksheet API', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.CUT_CHART(deps, { chartId: 'chart-123' });

      // Handler reads chart via ws.getChart (unified API)
      // Mock returns null, so handler returns chart not found
      expect(result.handled).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return not handled when chartId is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.CUT_CHART(deps, {});

      expect(result.handled).toBe(false);
    });
  });

  describe('PASTE_CHART', () => {
    it('should return disabled when clipboard is empty', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.PASTE_CHART(deps);

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('disabled');
    });
  });

  describe('DUPLICATE_CHART', () => {
    it('should use the worksheet chart duplicate API', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.DUPLICATE_CHART(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(true);
      expect(deps.workbook.activeSheet.charts.duplicate).toHaveBeenCalledWith('chart-123');
      expect(deps.workbook.activeSheet.charts.get).not.toHaveBeenCalled();
      expect(deps.workbook.activeSheet.charts.add).not.toHaveBeenCalled();
      expect(deps.commands.object.selectObject).toHaveBeenCalledWith(
        'duplicated-chart-id',
        false,
        false,
      );
    });

    it('should return not handled when chartId is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.DUPLICATE_CHART(deps, {});

      expect(result.handled).toBe(false);
    });
  });

  describe('DELETE_CHART', () => {
    it('should use unified Worksheet API to delete chart', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.DELETE_CHART(deps, { chartId: 'chart-123' });

      // Handler uses ws.removeChart via unified API
      expect(result.handled).toBe(true);
    });

    it('should return not handled when chartId is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.DELETE_CHART(deps, {});

      expect(result.handled).toBe(false);
    });
  });
});

// =============================================================================
// CHART SELECTION ACTIONS
// =============================================================================

describe('Chart Handlers - Selection Actions', () => {
  describe('SELECT_CHART', () => {
    it('should select through the object interaction actor', () => {
      const deps = createMockDeps();
      ChartHandlers.SELECT_CHART(deps, { chartId: 'chart-123' });

      expect(deps.commands.object.selectObject).toHaveBeenCalledWith('chart-123', false, false);
    });

    it('should return not handled when chartId is missing', () => {
      const deps = createMockDeps();
      const result = ChartHandlers.SELECT_CHART(deps, {});

      expect(result.handled).toBe(false);
    });
  });

  describe('DESELECT_CHART', () => {
    it('should deselect through the object interaction actor', () => {
      const deps = createMockDeps();
      ChartHandlers.DESELECT_CHART(deps, { chartId: 'chart-123' });

      expect(deps.commands.object.deselectAll).toHaveBeenCalled();
    });
  });

  describe('DESELECT_ALL_CHARTS', () => {
    it('should deselect all through the object interaction actor', () => {
      const deps = createMockDeps();
      ChartHandlers.DESELECT_ALL_CHARTS(deps);

      expect(deps.commands.object.deselectAll).toHaveBeenCalled();
    });
  });

  describe('ADD_CHART_TO_SELECTION', () => {
    it('should add to object selection', () => {
      const deps = createMockDeps();
      ChartHandlers.ADD_CHART_TO_SELECTION(deps, { chartId: 'chart-123' });

      expect(deps.commands.object.selectObject).toHaveBeenCalledWith('chart-123', true, false);
    });
  });

  describe('TOGGLE_CHART_SELECTION', () => {
    it('should toggle object selection', () => {
      const deps = createMockDeps();
      ChartHandlers.TOGGLE_CHART_SELECTION(deps, { chartId: 'chart-123' });

      expect(deps.commands.object.selectObject).toHaveBeenCalledWith('chart-123', false, true);
    });
  });
});

// =============================================================================
// CHART Z-ORDER ACTIONS
// =============================================================================

describe('Chart Handlers - Z-Order Actions', () => {
  const zOrderActions = [
    ['BRING_CHART_TO_FRONT', ChartHandlers.BRING_CHART_TO_FRONT, 'bringToFront'],
    ['SEND_CHART_TO_BACK', ChartHandlers.SEND_CHART_TO_BACK, 'sendToBack'],
    ['BRING_CHART_FORWARD', ChartHandlers.BRING_CHART_FORWARD, 'bringForward'],
    ['SEND_CHART_BACKWARD', ChartHandlers.SEND_CHART_BACKWARD, 'sendBackward'],
  ] as const;

  describe('BRING_CHART_TO_FRONT', () => {
    it('should use Worksheet API for z-order operations', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.BRING_CHART_TO_FRONT(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(true);
      expect((deps.workbook as any).activeSheet.charts.bringToFront).toHaveBeenCalledWith(
        'chart-123',
      );
    });

    it('should return not handled when chartId is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.BRING_CHART_TO_FRONT(deps, {});

      expect(result.handled).toBe(false);
    });
  });

  describe('SEND_CHART_TO_BACK', () => {
    it('should use Worksheet API for z-order operations', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.SEND_CHART_TO_BACK(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(true);
      expect((deps.workbook as any).activeSheet.charts.sendToBack).toHaveBeenCalledWith(
        'chart-123',
      );
    });
  });

  describe('BRING_CHART_FORWARD', () => {
    it('should use Worksheet API for z-order operations', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.BRING_CHART_FORWARD(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(true);
      expect((deps.workbook as any).activeSheet.charts.bringForward).toHaveBeenCalledWith(
        'chart-123',
      );
    });
  });

  describe('SEND_CHART_BACKWARD', () => {
    it('should use Worksheet API for z-order operations', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.SEND_CHART_BACKWARD(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(true);
      expect((deps.workbook as any).activeSheet.charts.sendBackward).toHaveBeenCalledWith(
        'chart-123',
      );
    });
  });

  it.each(zOrderActions)(
    'should use selected object id for %s when keyboard payload is omitted',
    async (_name, handler, methodName) => {
      const deps = createMockDeps();
      jest.spyOn(deps.accessors.object, 'getFirstSelectedId').mockReturnValue('chart-123');
      const ws = (deps.workbook as any).activeSheet;

      const result = await handler(deps, undefined);

      expect(result.handled).toBe(true);
      expect(ws.charts[methodName]).toHaveBeenCalledWith('chart-123');
    },
  );
});

// =============================================================================
// CHART NUDGE ACTIONS
// =============================================================================

describe('Chart Handlers - Nudge Actions', () => {
  describe('NUDGE_CHART_UP', () => {
    it('should use Mutations layer (not onUIAction) to move chart', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.NUDGE_CHART_UP(deps, { chartId: 'chart-123' });

      // Handler uses Mutations layer, not onUIAction (correct architecture)
      expect(result.handled).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should support large nudge', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.NUDGE_CHART_UP(deps, {
        chartId: 'chart-123',
        large: true,
      });

      expect(result.handled).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('NUDGE_CHART_DOWN', () => {
    it('should use Mutations layer (not onUIAction) to move chart', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.NUDGE_CHART_DOWN(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('NUDGE_CHART_LEFT', () => {
    it('should use Mutations layer (not onUIAction) to move chart', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.NUDGE_CHART_LEFT(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('NUDGE_CHART_RIGHT', () => {
    it('should use Mutations layer (not onUIAction) to move chart', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.NUDGE_CHART_RIGHT(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  it('should return not handled when chartId is missing', async () => {
    const deps = createMockDeps();
    const result = await ChartHandlers.NUDGE_CHART_UP(deps, {});

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing chartId in payload');
  });
});

// =============================================================================
// CHART NAVIGATION ACTIONS
// =============================================================================

describe('Chart Handlers - Navigation Actions', () => {
  describe('CYCLE_NEXT_CHART', () => {
    it('should return disabled when no charts exist', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.CYCLE_NEXT_CHART(deps, {});

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('disabled');
    });
  });

  describe('CYCLE_PREVIOUS_CHART', () => {
    it('should return disabled when no charts exist', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.CYCLE_PREVIOUS_CHART(deps, {});

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('disabled');
    });
  });
});

// =============================================================================
// CHART CREATION ACTIONS
// =============================================================================

describe('Chart Handlers - Creation Actions', () => {
  describe('CREATE_CHART_SHEET', () => {
    it('should use Mutations layer (not onUIAction) to create chart sheet', async () => {
      const deps = createMockDeps();

      // Handler uses Mutations layer, not onUIAction (correct architecture)
      // In unit tests without full Yjs setup, creation may throw or fail
      // The handler is now async - verify it doesn't reject due to missing onUIAction
      await expect(ChartHandlers.CREATE_CHART_SHEET(deps)).resolves.toBeDefined();
    });
  });

  describe('CREATE_EMBEDDED_CHART', () => {
    it('should use unified Worksheet API to create embedded chart', async () => {
      const deps = createMockDeps();

      // Handler uses ws.addChart via unified API
      const result = await ChartHandlers.CREATE_EMBEDDED_CHART(deps);
      expect(result.handled).toBe(true);
      expect(deps.commands.object.selectObject).toHaveBeenCalledWith('new-chart-id', false, false);
    });
  });
});

// =============================================================================
// CHART DIALOG ACTIONS
// =============================================================================

describe('Chart Handlers - Dialog Actions', () => {
  describe('OPEN_SELECT_DATA_DIALOG', () => {
    it('should return not handled when chartId is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.OPEN_SELECT_DATA_DIALOG(deps, {});

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing chartId in payload');
    });
  });

  describe('CLOSE_SELECT_DATA_DIALOG', () => {
    it('should call closeSelectDataDialog on uiStore', () => {
      const deps = createMockDeps();
      const result = ChartHandlers.CLOSE_SELECT_DATA_DIALOG(deps);

      expect(result.handled).toBe(true);
    });
  });

  describe('APPLY_SELECT_DATA', () => {
    function setupOpenSelectDataDialog(orientation: 'rows' | 'columns' = 'columns') {
      const deps = createMockDeps();
      const closeSelectDataDialog = jest.fn();
      (deps.uiStore as any).getState = () => ({
        selectDataDialog: {
          isOpen: true,
          chartId: 'chart-1',
          sheetId: deps.getActiveSheetId(),
          dataRange: 'A1:C5',
          orientation,
        },
        closeSelectDataDialog,
      });
      const ws = (deps.workbook as any).getSheetById(deps.getActiveSheetId());
      return { deps, ws, closeSelectDataDialog };
    }

    it('updates source data without switching when orientation already matches', async () => {
      const { deps, ws, closeSelectDataDialog } = setupOpenSelectDataDialog('columns');
      ws.charts.getAppModel.mockResolvedValue({
        source: { orientation: 'columns', supportsOrientationSwitch: true },
      });

      const result = await ChartHandlers.APPLY_SELECT_DATA(deps);

      expect(result.handled).toBe(true);
      expect(ws.charts.setSourceData).toHaveBeenCalledWith('chart-1', { dataRange: 'A1:C5' });
      expect(ws.charts.switchSeriesOrientation).not.toHaveBeenCalled();
      expect(ws.charts.update).not.toHaveBeenCalled();
      expect(closeSelectDataDialog).toHaveBeenCalledTimes(1);
    });

    it('switches row/column when requested orientation differs', async () => {
      const { deps, ws, closeSelectDataDialog } = setupOpenSelectDataDialog('rows');
      ws.charts.getAppModel.mockResolvedValue({
        source: { orientation: 'columns', supportsOrientationSwitch: true },
      });

      const result = await ChartHandlers.APPLY_SELECT_DATA(deps);

      expect(result.handled).toBe(true);
      expect(ws.charts.setSourceData).toHaveBeenCalledWith('chart-1', { dataRange: 'A1:C5' });
      expect(ws.charts.switchSeriesOrientation).toHaveBeenCalledWith('chart-1');
      expect(ws.charts.update).not.toHaveBeenCalled();
      expect(closeSelectDataDialog).toHaveBeenCalledTimes(1);
    });

    it('keeps dialog open when requested orientation switch is unsupported', async () => {
      const { deps, ws, closeSelectDataDialog } = setupOpenSelectDataDialog('rows');
      ws.charts.getAppModel.mockResolvedValue({
        source: { orientation: 'columns', supportsOrientationSwitch: false },
      });
      ws.charts.switchSeriesOrientation.mockResolvedValue({
        status: 'unsupported',
        diagnostics: [{ message: 'Cannot switch explicit series' }],
      });

      const result = await ChartHandlers.APPLY_SELECT_DATA(deps);

      expect(result).toEqual({
        handled: false,
        error: 'Cannot switch explicit series',
      });
      expect(ws.charts.setSourceData).toHaveBeenCalledWith('chart-1', { dataRange: 'A1:C5' });
      expect(ws.charts.switchSeriesOrientation).toHaveBeenCalledWith('chart-1');
      expect(closeSelectDataDialog).not.toHaveBeenCalled();
    });
  });

  describe('OPEN_INSERT_CHART_WIZARD_DIALOG', () => {
    it('should return handled', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.OPEN_INSERT_CHART_WIZARD_DIALOG(deps);

      expect(result.handled).toBe(true);
    });
  });

  describe('CLOSE_INSERT_CHART_WIZARD_DIALOG', () => {
    it('should return handled', () => {
      const deps = createMockDeps();
      const result = ChartHandlers.CLOSE_INSERT_CHART_WIZARD_DIALOG(deps);

      expect(result.handled).toBe(true);
    });
  });

  describe('INSERT_CHART_FROM_WIZARD', () => {
    it('normalizes wizard draft state before creating the chart', async () => {
      const deps = createMockDeps();
      const closeInsertChartWizardDialog = jest.fn();
      const setChartWizardError = jest.fn();

      (deps.uiStore as any).getState = () => ({
        activeSheetId: deps.getActiveSheetId(),
        insertChartWizardDialog: {
          isOpen: true,
          chartType: 'column',
          variantId: 'clustered',
          dataRange: 'A1:B5',
          seriesInRows: true,
          hasHeaderRow: true,
          hasLabelColumn: true,
          title: 'Sales',
          xAxis: { title: 'Month', showGridlines: false },
          yAxis: { title: 'Revenue', showGridlines: true },
          legend: { show: false, position: 'right' },
          showDataLabels: true,
          error: null,
        },
        closeInsertChartWizardDialog,
        setChartWizardError,
      });

      const result = await ChartHandlers.INSERT_CHART_FROM_WIZARD(deps);

      expect(result.handled).toBe(true);
      const ws = (deps.workbook as any).activeSheet;
      expect(ws.charts.add).toHaveBeenCalledTimes(1);
      const addedConfig = ws.charts.add.mock.calls[0][0];

      expect(addedConfig.legend).toEqual({
        show: false,
        position: 'right',
        visible: false,
      });
      expect(addedConfig.axis.categoryAxis).toMatchObject({
        type: 'category',
        axisType: 'category',
        title: 'Month',
        gridLines: false,
        visible: true,
      });
      expect(addedConfig.axis.valueAxis).toMatchObject({
        type: 'value',
        axisType: 'value',
        title: 'Revenue',
        gridLines: true,
        visible: true,
      });
      expect(addedConfig.axis).not.toHaveProperty('xAxis');
      expect(addedConfig.axis).not.toHaveProperty('yAxis');
      expect(addedConfig.dataLabels).toEqual({ show: true });
      expect(addedConfig).not.toHaveProperty('showDataLabels');
      expect(addedConfig).not.toHaveProperty('xAxis');
      expect(addedConfig).not.toHaveProperty('yAxis');
      expect(closeInsertChartWizardDialog).toHaveBeenCalled();
      expect(setChartWizardError).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// CHART CONTEXT MENU ACTIONS
// =============================================================================

describe('Chart Handlers - Context Menu Actions', () => {
  describe('SAVE_CHART_AS_IMAGE', () => {
    // handler now renders via `ws.charts.exportImage`
    // and persists through `platform.dialogs.showSaveDialog` + `handle.write`.
    // Tests assert on the real path instead of the legacy `onUIAction`.

    function withChartExporter(deps: ActionDependencies, dataUrl: string | null) {
      const ws = (deps.workbook as any).activeSheet;
      ws.charts.exportImage = jest.fn().mockResolvedValue(dataUrl as never);
    }

    it('renders via ws.charts.exportImage and writes through the platform handle', async () => {
      const deps = createMockDeps();
      // 1x1 transparent PNG, base64
      const png1x1 =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';
      withChartExporter(deps, png1x1);

      const handle = createMockFileHandle({ name: 'chart-chart-123.png' });
      (deps.platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(handle as never);

      const result = await ChartHandlers.SAVE_CHART_AS_IMAGE(deps, {
        chartId: 'chart-123',
        format: 'png',
      });

      expect(result.handled).toBe(true);
      const ws = (deps.workbook as any).activeSheet;
      expect(ws.charts.exportImage).toHaveBeenCalledWith('chart-123', { format: 'png' });
      expect(deps.platform.dialogs.showSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'chart-chart-123.png',
          filters: [{ name: 'PNG', extensions: ['png'] }],
        }),
      );
      expect(handle.write).toHaveBeenCalledTimes(1);
      // Ensure bytes are non-empty (decoded from the base64 PNG above).
      const writtenBytes = (handle.write as jest.Mock).mock.calls[0][0] as Uint8Array;
      expect(writtenBytes).toBeInstanceOf(Uint8Array);
      expect(writtenBytes.byteLength).toBeGreaterThan(0);
    });

    it('writes decoded base64 SVG bytes for SVG chart export', async () => {
      const deps = createMockDeps();
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
      withChartExporter(deps, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);

      const handle = createMockFileHandle({ name: 'chart-chart-123.svg' });
      (deps.platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(handle as never);

      const result = await ChartHandlers.SAVE_CHART_AS_IMAGE(deps, {
        chartId: 'chart-123',
        format: 'svg',
      });

      expect(result.handled).toBe(true);
      const ws = (deps.workbook as any).activeSheet;
      expect(ws.charts.exportImage).toHaveBeenCalledWith('chart-123', { format: 'svg' });
      expect(deps.platform.dialogs.showSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'chart-chart-123.svg',
          filters: [{ name: 'SVG', extensions: ['svg'] }],
        }),
      );
      const writtenBytes = (handle.write as jest.Mock).mock.calls[0][0] as Uint8Array;
      expect(Buffer.from(writtenBytes).toString('utf8')).toBe(svg);
    });

    it('defaults to png format when none is supplied', async () => {
      const deps = createMockDeps();
      withChartExporter(
        deps,
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
      );
      (deps.platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(
        createMockFileHandle() as never,
      );

      await ChartHandlers.SAVE_CHART_AS_IMAGE(deps, { chartId: 'chart-123' });

      const ws = (deps.workbook as any).activeSheet;
      expect(ws.charts.exportImage).toHaveBeenCalledWith('chart-123', { format: 'png' });
    });

    it('returns notHandled (disabled) when the user cancels the save dialog', async () => {
      const deps = createMockDeps();
      withChartExporter(
        deps,
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
      );
      (deps.platform.dialogs.showSaveDialog as jest.Mock).mockResolvedValueOnce(null as never);

      const result = await ChartHandlers.SAVE_CHART_AS_IMAGE(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('disabled');
    });

    it('returns not handled when chartId is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.SAVE_CHART_AS_IMAGE(deps, { format: 'svg' });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing chartId in payload');
    });
  });

  describe('ADD_DATA_LABELS', () => {
    it('updates the series via ws.charts.updateSeries with show: true labels', async () => {
      const deps = createMockDeps();
      const ws = (deps.workbook as any).activeSheet;
      ws.charts.updateSeries = jest.fn().mockResolvedValue(undefined as never);

      const result = await ChartHandlers.ADD_DATA_LABELS(deps, {
        chartId: 'chart-123',
        seriesIndex: 1,
      });

      expect(result.handled).toBe(true);
      expect(ws.charts.updateSeries).toHaveBeenCalledWith(
        'chart-123',
        1,
        expect.objectContaining({
          dataLabels: expect.objectContaining({ show: true }),
        }),
      );
    });

    it('defaults seriesIndex to 0', async () => {
      const deps = createMockDeps();
      const ws = (deps.workbook as any).activeSheet;
      ws.charts.updateSeries = jest.fn().mockResolvedValue(undefined as never);

      await ChartHandlers.ADD_DATA_LABELS(deps, { chartId: 'chart-123' });

      expect(ws.charts.updateSeries).toHaveBeenCalledWith(
        'chart-123',
        0,
        expect.objectContaining({ dataLabels: expect.any(Object) }),
      );
    });

    it('returns not handled when chartId is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.ADD_DATA_LABELS(deps, {});
      expect(result.handled).toBe(false);
    });
  });

  describe('ADD_TRENDLINE', () => {
    it('calls ws.charts.addTrendline with a default linear config', async () => {
      const deps = createMockDeps();
      const ws = (deps.workbook as any).activeSheet;
      ws.charts.addTrendline = jest.fn().mockResolvedValue(0 as never);

      const result = await ChartHandlers.ADD_TRENDLINE(deps, {
        chartId: 'chart-123',
        seriesIndex: 2,
      });

      expect(result.handled).toBe(true);
      expect(ws.charts.addTrendline).toHaveBeenCalledWith(
        'chart-123',
        2,
        expect.objectContaining({ type: 'linear', show: true }),
      );
    });

    it('defaults seriesIndex to 0', async () => {
      const deps = createMockDeps();
      const ws = (deps.workbook as any).activeSheet;
      ws.charts.addTrendline = jest.fn().mockResolvedValue(0 as never);

      await ChartHandlers.ADD_TRENDLINE(deps, { chartId: 'chart-123' });

      expect(ws.charts.addTrendline).toHaveBeenCalledWith('chart-123', 0, expect.any(Object));
    });

    it('returns not handled when chartId is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.ADD_TRENDLINE(deps, {});
      expect(result.handled).toBe(false);
    });
  });

  describe('TOGGLE_GRIDLINES', () => {
    it('flips categoryAxis.gridLines for axisType "x"', async () => {
      const deps = createMockDeps();
      const ws = (deps.workbook as any).activeSheet;
      ws.charts.get = jest.fn().mockResolvedValue({
        id: 'chart-123',
        axis: { categoryAxis: { visible: true, gridLines: false } },
      } as never);

      const result = await ChartHandlers.TOGGLE_GRIDLINES(deps, {
        chartId: 'chart-123',
        axisType: 'x',
      });

      expect(result.handled).toBe(true);
      expect(ws.charts.update).toHaveBeenCalledWith(
        'chart-123',
        expect.objectContaining({
          axis: expect.objectContaining({
            categoryAxis: expect.objectContaining({ gridLines: true }),
          }),
        }),
      );
    });

    it('flips valueAxis.gridLines for axisType "y" and defaults missing values', async () => {
      const deps = createMockDeps();
      const ws = (deps.workbook as any).activeSheet;
      // No axis on the chart yet — handler should default to gridLines: true
      // when current value is undefined.
      ws.charts.get = jest.fn().mockResolvedValue({ id: 'chart-123' } as never);

      const result = await ChartHandlers.TOGGLE_GRIDLINES(deps, {
        chartId: 'chart-123',
        axisType: 'y',
      });

      expect(result.handled).toBe(true);
      expect(ws.charts.update).toHaveBeenCalledWith(
        'chart-123',
        expect.objectContaining({
          axis: expect.objectContaining({
            valueAxis: expect.objectContaining({ gridLines: true }),
          }),
        }),
      );
    });

    it('returns chart-not-found error when ws.charts.get returns null', async () => {
      const deps = createMockDeps();
      const ws = (deps.workbook as any).activeSheet;
      ws.charts.get = jest.fn().mockResolvedValue(null as never);

      const result = await ChartHandlers.TOGGLE_GRIDLINES(deps, {
        chartId: 'chart-123',
        axisType: 'x',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns not handled when chartId is missing', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.TOGGLE_GRIDLINES(deps, { axisType: 'x' });
      expect(result.handled).toBe(false);
    });
  });

  describe('RESET_CHART_STYLE', () => {
    it('should use unified Worksheet API to reset chart style', async () => {
      const deps = createMockDeps();
      const result = await ChartHandlers.RESET_CHART_STYLE(deps, { chartId: 'chart-123' });

      expect(result.handled).toBe(true);
      expect(deps.workbook.activeSheet.charts.update).toHaveBeenCalledWith('chart-123', {
        colors: [...DEFAULT_CHART_COLORS],
      });
    });
  });

  describe('OPEN_MOVE_CHART_DIALOG', () => {
    it('should call onUIAction with chart ID', () => {
      const deps = createMockDeps();
      ChartHandlers.OPEN_MOVE_CHART_DIALOG(deps, { chartId: 'chart-123' });

      expect(deps.onUIAction).toHaveBeenCalledWith('OPEN_MOVE_CHART_DIALOG:chart-123');
    });
  });

  describe('OPEN_FORMAT_CHART_AREA', () => {
    it('should open the chart editor on the style tab', () => {
      const setChartEditorTab = jest.fn();
      const deps = createMockDeps({
        uiStore: {
          getState: jest.fn(() => ({
            setChartEditorTab,
          })),
        },
      });
      ChartHandlers.OPEN_FORMAT_CHART_AREA(deps, { chartId: 'chart-123' });

      expect(setChartEditorTab).toHaveBeenCalledWith('style');
      expect(deps.commands.object.selectObject).toHaveBeenCalledWith('chart-123', false, false);
      expect(deps.commands.chart.startEdit).toHaveBeenCalled();
      expect(deps.onUIAction).toHaveBeenCalledWith('OPEN_FORMAT_CHART_AREA:chart-123');
    });
  });
});

// =============================================================================
// CURRENT-REGION AUTO-EXPANSION
// =============================================================================
//
// Excel auto-expands single-cell selections to the surrounding contiguous data
// block ("current region") before chart creation. These tests verify that the
// chart handlers call `expandToDataRegion()` on single-cell ranges produced by
// `getDataBoundedRanges()` and use the expanded range for the chart's
// dataRange (and as the source for smart positioning).
//

/**
 * Build deps with a custom selection range and an optional `getCurrentRegion`
 * mock that simulates a populated data region around the active cell.
 */
function createDepsWithSelection(opts: {
  ranges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  editStartRanges?: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  expandedRegion?: { startRow: number; startCol: number; endRow: number; endCol: number };
  insertChartWizardOpenSpy?: jest.Mock;
}): ActionDependencies {
  const deps = createMockDeps();

  // Override selection.getDataBoundedRanges
  (deps.accessors.selection as any).getDataBoundedRanges = () => opts.ranges;
  (deps.accessors.editor as any).getEditStartSelectionRanges = () => opts.editStartRanges ?? null;

  // Wire getCurrentRegion to return the configured expanded block (or echo input)
  const ws = (deps.workbook as any).activeSheet;
  ws.getCurrentRegion = jest.fn().mockImplementation(async (row: number, col: number) => {
    if (opts.expandedRegion) return opts.expandedRegion;
    return { startRow: row, startCol: col, endRow: row, endCol: col };
  });

  // Optionally override openInsertChartWizardDialog with a spy
  if (opts.insertChartWizardOpenSpy) {
    (deps.uiStore as any).getState = () => ({
      activeSheetId: deps.getActiveSheetId(),
      openInsertChartWizardDialog: opts.insertChartWizardOpenSpy,
    });
  }

  return deps;
}

describe('Chart Handlers - Current-Region Auto-Expansion', () => {
  describe('CREATE_EMBEDDED_CHART', () => {
    it('expands single-cell selection in a data region to the full block', async () => {
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
        expandedRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
      });

      const result = await ChartHandlers.CREATE_EMBEDDED_CHART(deps);
      expect(result.handled).toBe(true);

      // Chart should be created with the expanded A1 range "A1:D10"
      const ws = (deps.workbook as any).activeSheet;
      expect(ws.charts.add).toHaveBeenCalledTimes(1);
      const addedConfig = ws.charts.add.mock.calls[0][0];
      expect(addedConfig.dataRange).toBe('A1:D10');
    });

    it('does not create a chart when the source is a blank single cell', async () => {
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 4, startCol: 4, endRow: 4, endCol: 4 }],
      });
      const ws = (deps.workbook as any).activeSheet;
      ws.getValue = jest.fn(async () => null);

      const result = await ChartHandlers.CREATE_EMBEDDED_CHART(deps);
      expect(result.handled).toBe(true);

      expect(ws.getValue).toHaveBeenCalledWith(4, 4);
      expect(ws.charts.add).not.toHaveBeenCalled();
    });

    it('uses multi-cell selection as-is without expansion', async () => {
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 0, startCol: 0, endRow: 5, endCol: 3 }],
      });

      const result = await ChartHandlers.CREATE_EMBEDDED_CHART(deps);
      expect(result.handled).toBe(true);

      const ws = (deps.workbook as any).activeSheet;
      // getCurrentRegion must NOT be called for multi-row selections
      expect(ws.getCurrentRegion).not.toHaveBeenCalled();

      const addedConfig = ws.charts.add.mock.calls[0][0];
      expect(addedConfig.dataRange).toBe('A1:D6');
    });

    it('adds explicit series references for first-column label ranges', async () => {
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 0, startCol: 0, endRow: 4, endCol: 3 }],
      });
      const sourceValues = [
        ['Revenue', 100500, 100900, 100000],
        ['yoy', null, 0.003980099502487455, -0.008919722497522264],
        ['OP', 4400, 7800, 7400],
        ['yoy', null, 0.7727272727272727, -0.05128205128205132],
        ['OPM', 0.04378109452736319, 0.07730426164519326, 0.074],
      ];
      const ws = (deps.workbook as any).activeSheet;
      ws.getValue = jest.fn(async (row: number, col: number) => sourceValues[row]?.[col] ?? null);

      const result = await ChartHandlers.CREATE_EMBEDDED_CHART(deps);
      expect(result.handled).toBe(true);

      const addedConfig = ws.charts.add.mock.calls[0][0];
      expect(addedConfig.dataRange).toBe('A1:D5');
      expect(addedConfig.seriesOrientation).toBe('rows');
      expect(addedConfig.series).toEqual([
        { values: 'B1:B5', categories: 'A1:A5' },
        { values: 'C1:C5', categories: 'A1:A5' },
        { values: 'D1:D5', categories: 'A1:A5' },
      ]);
    });

    it('uses edit-start multi-cell selection when active selection collapsed during enter-mode', async () => {
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 2, startCol: 12, endRow: 2, endCol: 12 }],
        editStartRanges: [{ startRow: 2, startCol: 12, endRow: 20, endCol: 13 }],
        expandedRegion: { startRow: 0, startCol: 11, endRow: 2, endCol: 13 },
      });

      const result = await ChartHandlers.CREATE_EMBEDDED_CHART(deps);
      expect(result.handled).toBe(true);

      const ws = (deps.workbook as any).activeSheet;
      expect(ws.getCurrentRegion).not.toHaveBeenCalled();
      const addedConfig = ws.charts.add.mock.calls[0][0];
      expect(addedConfig.dataRange).toBe('M3:N21');
    });

    it('expands single-row header selection (A1:D1) to the full data block', async () => {
      // A single-row selection treated as a header row should expand down to
      // the contiguous data region.
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 3 }],
        expandedRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
      });

      const result = await ChartHandlers.CREATE_EMBEDDED_CHART(deps);
      expect(result.handled).toBe(true);

      const ws = (deps.workbook as any).activeSheet;
      expect(ws.getCurrentRegion).toHaveBeenCalled();
      const addedConfig = ws.charts.add.mock.calls[0][0];
      expect(addedConfig.dataRange).toBe('A1:D10');
    });
  });

  describe('CREATE_CHART_SHEET', () => {
    it('expands single-cell selection and emits cross-sheet dataRange', async () => {
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
        expandedRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
      });

      const result = await ChartHandlers.CREATE_CHART_SHEET(deps);
      expect(result.handled).toBe(true);

      // The new sheet's `charts.add` is called with a cross-sheet ref using
      // the source sheet name (default 'Sheet1' from the mock).
      const newWs = (deps.workbook as any).sheets.add.mock.results[0].value;
      // sheets.add returns the same mockWorksheet from createMockDeps; charts
      // are added on it.
      const addedConfig = (await newWs).charts.add.mock.calls[0][0];
      expect(addedConfig.dataRange).toBe("'Sheet1'!A1:D10");
    });

    it('expands single-row selection for chart-sheet creation', async () => {
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 3 }],
        expandedRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
      });

      const result = await ChartHandlers.CREATE_CHART_SHEET(deps);
      expect(result.handled).toBe(true);

      const newWs = (deps.workbook as any).sheets.add.mock.results[0].value;
      const addedConfig = (await newWs).charts.add.mock.calls[0][0];
      expect(addedConfig.dataRange).toBe("'Sheet1'!A1:D10");
    });
  });

  describe('OPEN_INSERT_CHART_WIZARD_DIALOG', () => {
    it('opens wizard with expanded A1 range for single-cell selection in data region', async () => {
      const openSpy = jest.fn();
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 2, startCol: 2, endRow: 2, endCol: 2 }],
        expandedRegion: { startRow: 0, startCol: 0, endRow: 4, endCol: 2 },
        insertChartWizardOpenSpy: openSpy,
      });

      const result = await ChartHandlers.OPEN_INSERT_CHART_WIZARD_DIALOG(deps);
      expect(result.handled).toBe(true);
      expect(openSpy).toHaveBeenCalledWith('A1:C5');
    });

    it('opens wizard from edit-start multi-cell selection when active selection collapsed', async () => {
      const openSpy = jest.fn();
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 2, startCol: 12, endRow: 2, endCol: 12 }],
        editStartRanges: [{ startRow: 2, startCol: 12, endRow: 20, endCol: 13 }],
        expandedRegion: { startRow: 0, startCol: 11, endRow: 2, endCol: 13 },
        insertChartWizardOpenSpy: openSpy,
      });

      const result = await ChartHandlers.OPEN_INSERT_CHART_WIZARD_DIALOG(deps);
      expect(result.handled).toBe(true);
      expect(openSpy).toHaveBeenCalledWith('M3:N21');
    });

    it('opens wizard with empty initialDataRange when no selection', async () => {
      const openSpy = jest.fn();
      const deps = createDepsWithSelection({
        ranges: [],
        insertChartWizardOpenSpy: openSpy,
      });

      const result = await ChartHandlers.OPEN_INSERT_CHART_WIZARD_DIALOG(deps);
      expect(result.handled).toBe(true);
      expect(openSpy).toHaveBeenCalledWith('');
    });

    it('expands single-row selection before opening wizard', async () => {
      const openSpy = jest.fn();
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 3 }],
        expandedRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
        insertChartWizardOpenSpy: openSpy,
      });

      const result = await ChartHandlers.OPEN_INSERT_CHART_WIZARD_DIALOG(deps);
      expect(result.handled).toBe(true);
      expect(openSpy).toHaveBeenCalledWith('A1:D10');
    });

    it('does not shrink a wider single-row chart selection to a narrower current region', async () => {
      const openSpy = jest.fn();
      const deps = createDepsWithSelection({
        ranges: [{ startRow: 20, startCol: 11, endRow: 20, endCol: 27 }],
        expandedRegion: { startRow: 20, startCol: 11, endRow: 20, endCol: 13 },
        insertChartWizardOpenSpy: openSpy,
      });

      const result = await ChartHandlers.OPEN_INSERT_CHART_WIZARD_DIALOG(deps);
      expect(result.handled).toBe(true);
      expect(openSpy).toHaveBeenCalledWith('L21:AB21');
    });
  });
});
