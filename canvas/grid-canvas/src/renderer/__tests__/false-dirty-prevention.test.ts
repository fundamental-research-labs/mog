/**
 * False Dirty Prevention Tests
 *
 * Verifies dirty-tracking optimizations:
 *
 * Category A: Data callback reference changes do NOT trigger `markDirty('cells')`.
 *   The actual cell dirty signal comes from BinaryViewportBuffer.applyBinaryMutation().
 *
 * Category B: Config/state handlers with identity guards skip `markDirty` when
 *   called with the same value.
 *
 * Category C: State handlers with reference-identity guards skip `markDirty` when
 *   called with the same reference.
 *
 * Cross-layer: Some data callbacks mark non-cell layers (ui, validationCircles)
 *   but must NOT mark cells dirty.
 *
 * @module grid-canvas/renderer/__tests__/false-dirty-prevention
 */

import { jest } from '@jest/globals';
import { GridRendererImpl } from '../grid-renderer';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a minimal mock of GridRendererImpl with just enough structure to
 * exercise buildFieldHandlers().
 *
 * The adapters are plain objects with setter methods matching the real adapter
 * signatures. The engine.markDirty is a jest.fn() so we can assert on calls.
 */
function createFakeForFieldHandlers() {
  const markDirty = jest.fn<void, [string]>();

  // Minimal cell adapter — stores function references via setters
  const cellAdapter = {
    setCellValueFn: jest.fn(),
    setGetFormattedValue: jest.fn(),
    setCellFormatFn: jest.fn(),
    setHasFormula: jest.fn(),
    setGetFormula: jest.fn(),
    setGetCellHyperlink: jest.fn(),
    setGetBgColorOverride: jest.fn(),
    setGetFontColorOverride: jest.fn(),
    setGetDataBar: jest.fn(),
    setGetIcon: jest.fn(),
    setIsCheckboxCell: jest.fn(),
    setHasComment: jest.fn(),
    setIsProjectedPosition: jest.fn(),
    setGetProjectionSourcePosition: jest.fn(),
    setGetProjectionRange: jest.fn(),
    setGetCellBindingStatus: jest.fn(),
    setGetSparklineRenderData: jest.fn(),
    setGetTableAtCell: jest.fn(),
    setHasTableColumnFilter: jest.fn(),
    setGetFilterHeaderInfo: jest.fn(),
    setHasValidationErrors: jest.fn(),
    setDropdownCells: jest.fn(),
    setShowZeroValues: jest.fn(function (this: any, v: boolean) {
      this.showZeroValues = v;
    }),
    showZeroValues: true,
  };

  // Minimal sheet adapter — stores config values
  const sheetAdapter = {
    theme: null as unknown,
    culture: null as unknown,
    showGridlines: true,
    gridlineColor: '#e0e0e0',
    rightToLeft: false,
    showRowHeaders: true,
    showColumnHeaders: true,
    showCutCopyIndicator: true,
    allowDragFill: true,
    validationCirclesVisible: false,
    previewFont: null as string | null,
    blockedEditAttempt: null as unknown,
    setTheme: jest.fn(function (this: any, v: unknown) {
      this.theme = v;
    }),
    setCulture: jest.fn(function (this: any, v: unknown) {
      this.culture = v;
    }),
    setShowGridlines: jest.fn(function (this: any, v: boolean) {
      this.showGridlines = v;
    }),
    setGridlineColor: jest.fn(function (this: any, v: string) {
      this.gridlineColor = v;
    }),
    setRightToLeft: jest.fn(function (this: any, v: boolean) {
      this.rightToLeft = v;
    }),
    setShowRowHeaders: jest.fn(function (this: any, v: boolean) {
      this.showRowHeaders = v;
    }),
    setShowColumnHeaders: jest.fn(function (this: any, v: boolean) {
      this.showColumnHeaders = v;
    }),
    setShowCutCopyIndicator: jest.fn(function (this: any, v: boolean) {
      this.showCutCopyIndicator = v;
    }),
    setAllowDragFill: jest.fn(function (this: any, v: boolean) {
      this.allowDragFill = v;
    }),
    setValidationCirclesVisible: jest.fn(function (this: any, v: boolean) {
      this.validationCirclesVisible = v;
    }),
    setPreviewFont: jest.fn(function (this: any, v: string | null) {
      this.previewFont = v;
    }),
    setBlockedEditAttempt: jest.fn(function (this: any, v: unknown) {
      this.blockedEditAttempt = v;
    }),
    setTotalRows: jest.fn(),
    setTotalCols: jest.fn(),
  };

  // Minimal selection adapter
  const selectionAdapter = {
    updateSelection: jest.fn(),
    updateEditor: jest.fn(),
    updateClipboard: jest.fn(),
    updateSearchHighlights: jest.fn(),
    getSearchHighlights: jest.fn(() => null),
  };

  // Minimal collaboration adapter
  const collaborationAdapter = {
    updateCursors: jest.fn(),
  };

  // Minimal trace adapter — tracks last set value for identity guard
  let _traceArrows: unknown = null;
  let _getCellPositionFn: unknown = null;
  const traceAdapter = {
    setArrows: jest.fn((v: unknown) => {
      _traceArrows = v;
    }),
    getTraceArrows: jest.fn(() => _traceArrows),
    setGetCellPosition: jest.fn((v: unknown) => {
      _getCellPositionFn = v;
    }),
    getCellPositionFn: jest.fn(() => _getCellPositionFn),
  };

  // Minimal floating object adapter
  const floatingObjectAdapter = {
    setState: jest.fn(() => false),
    setObjectsFn: jest.fn(),
    getObjectsFn: jest.fn(() => null),
    setBoundsFn: jest.fn(() => false),
    setAllBoundsFn: jest.fn(() => false),
    setChartsFn: jest.fn(() => false),
    setChartPositionFn: jest.fn(() => false),
  };

  // Minimal grouping adapter — stores function references, returns previous
  let _groupingConfig = () => null;
  let _rowGroups = () => [] as any;
  let _colGroups = () => [] as any;
  let _rowLevels = () => [] as any;
  let _colLevels = () => [] as any;
  const groupingAdapter = {
    maxRowOutlineLevel: 0,
    maxColOutlineLevel: 0,
    getConfigFn: () => _groupingConfig,
    getRowGroupsFn: () => _rowGroups,
    getColumnGroupsFn: () => _colGroups,
    getRowOutlineLevelsFn: () => _rowLevels,
    getColumnOutlineLevelsFn: () => _colLevels,
    applyConfig: jest.fn((config: Record<string, unknown>) => {
      if (config.getGroupingConfig) _groupingConfig = config.getGroupingConfig as any;
      if (config.getRowGroups) _rowGroups = config.getRowGroups as any;
      if (config.getColumnGroups) _colGroups = config.getColumnGroups as any;
      if (config.getRowOutlineLevels) _rowLevels = config.getRowOutlineLevels as any;
      if (config.getColumnOutlineLevels) _colLevels = config.getColumnOutlineLevels as any;
    }),
  };

  // Minimal page break adapter
  let _breaks = { rowBreaks: [] as readonly any[], colBreaks: [] as readonly any[] };
  let _autoBreaks = { rowBreaks: [] as readonly any[], colBreaks: [] as readonly any[] };
  let _printArea: unknown = null;
  let _dragState: unknown = null;
  const pageBreakAdapter = {
    pageBreakPreviewMode: false,
    getPageBreaks: () => _breaks,
    getAutoPageBreaks: () => _autoBreaks,
    getPrintArea: () => _printArea,
    getPageBreakDragState: () => _dragState,
    setMode: jest.fn((v: boolean) => {
      pageBreakAdapter.pageBreakPreviewMode = v;
    }),
    setBreaks: jest.fn((v: any) => {
      _breaks = v;
    }),
    setAutoBreaks: jest.fn((v: any) => {
      _autoBreaks = v;
    }),
    setPrintArea: jest.fn((v: unknown) => {
      _printArea = v;
    }),
    setDragState: jest.fn((v: unknown) => {
      _dragState = v;
    }),
  };

  // Minimal grid layers (for binaryCellReader handlers)
  const gridLayers = {
    updateDataSources: jest.fn(),
    layers: [
      { id: 'background' },
      { id: 'cells' },
      { id: 'validationCircles' },
      { id: 'pageBreaks' },
      { id: 'selection' },
      { id: 'traceArrows' },
      { id: 'remoteCursors' },
      { id: 'ui' },
      { id: 'sticky-headers' },
      { id: 'headers' },
      { id: 'dividers' },
    ],
  };

  const fake = {
    engine: { markDirty },
    cellAdapter,
    sheetAdapter,
    selectionAdapter,
    collaborationAdapter,
    traceAdapter,
    floatingObjectAdapter,
    groupingAdapter,
    pageBreakAdapter,
    gridLayers,
    drawing: { layer: { id: 'drawing' } },
    overlay: { id: 'overlay' },
    // markAllDirty is called by rightToLeft handler — bind from prototype
    coords: {
      getViewport: () => ({ scrollTop: 0, scrollLeft: 0 }),
      setViewport: jest.fn(),
    },
  };

  // Bind prototype methods so `this` resolves to `fake`
  const proto = GridRendererImpl.prototype as any;
  (fake as any).markAllDirty = proto.markAllDirty.bind(fake);
  (fake as any).buildFieldHandlers = proto.buildFieldHandlers.bind(fake);

  // Build the field handlers
  const handlers: Record<string, (value: any) => void> = (fake as any).buildFieldHandlers();

  return { fake, markDirty, handlers, groupingAdapter, pageBreakAdapter, sheetAdapter };
}

// =============================================================================
// Tests
// =============================================================================

describe('Category A — data callbacks do NOT mark cells dirty', () => {
  /**
   * All these handlers store a new function reference but must NOT call
   * markDirty('cells'). The cell dirty signal comes from buffer mutations.
   */
  const dataCellCallbackNames = [
    'getCellValue',
    'getCellFormat',
    'getCellBindingStatus',
    'getSparklineRenderData',
    'getTableAtCell',
    'hasTableColumnFilter',
    'getFilterHeaderInfo',
    'dropdownCells',
    'binaryCellReader',
    'binaryCellReaderForViewport',
  ];

  it.each(dataCellCallbackNames)('%s handler does NOT call markDirty("cells")', (handlerName) => {
    const { markDirty, handlers } = createFakeForFieldHandlers();
    const newFn = jest.fn();
    handlers[handlerName](newFn);
    expect(markDirty).not.toHaveBeenCalledWith('cells');
  });

  it('getResolvedTableRange handler does not call markDirty at all', () => {
    const { markDirty, handlers } = createFakeForFieldHandlers();
    handlers['getResolvedTableRange'](jest.fn());
    expect(markDirty).not.toHaveBeenCalled();
  });
});

describe('Cross-layer handlers — mark non-cell layers only', () => {
  it('getTablesInSheet marks ui dirty but NOT cells', () => {
    const { markDirty, handlers } = createFakeForFieldHandlers();
    handlers['getTablesInSheet'](jest.fn());
    expect(markDirty).toHaveBeenCalledWith('ui');
    expect(markDirty).not.toHaveBeenCalledWith('cells');
  });

  it('hasValidationErrors marks validationCircles dirty but NOT cells', () => {
    const { markDirty, handlers } = createFakeForFieldHandlers();
    handlers['hasValidationErrors'](jest.fn());
    expect(markDirty).toHaveBeenCalledWith('validationCircles');
    expect(markDirty).not.toHaveBeenCalledWith('cells');
  });
});

describe('Category B — config identity guards (primitive values)', () => {
  describe('showGridlines', () => {
    it('marks background dirty on first call', () => {
      const { markDirty, handlers, sheetAdapter } = createFakeForFieldHandlers();
      // Default is true; set to false to trigger a change
      handlers['showGridlines'](false);
      expect(markDirty).toHaveBeenCalledWith('background');
    });

    it('does NOT mark dirty when called with the same value', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      // First call: set to false (change from default true)
      handlers['showGridlines'](false);
      markDirty.mockClear();
      // Second call: set to false again (no change)
      handlers['showGridlines'](false);
      expect(markDirty).not.toHaveBeenCalled();
    });

    it('marks dirty when value changes again', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      handlers['showGridlines'](false);
      markDirty.mockClear();
      handlers['showGridlines'](true);
      expect(markDirty).toHaveBeenCalledWith('background');
    });
  });

  describe('showZeroValues', () => {
    it('marks cells dirty on change', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      // Default is true, change to false
      handlers['showZeroValues'](false);
      expect(markDirty).toHaveBeenCalledWith('cells');
    });

    it('does NOT mark dirty when called with same value', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      handlers['showZeroValues'](false);
      markDirty.mockClear();
      handlers['showZeroValues'](false);
      expect(markDirty).not.toHaveBeenCalled();
    });
  });

  describe('validationCirclesVisible', () => {
    it('marks validationCircles dirty on change', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      handlers['validationCirclesVisible'](true);
      expect(markDirty).toHaveBeenCalledWith('validationCircles');
    });

    it('does NOT mark dirty when called with same value', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      handlers['validationCirclesVisible'](true);
      markDirty.mockClear();
      handlers['validationCirclesVisible'](true);
      expect(markDirty).not.toHaveBeenCalled();
    });
  });

  describe('showCutCopyIndicator', () => {
    it('marks ui dirty on change', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      handlers['showCutCopyIndicator'](false);
      expect(markDirty).toHaveBeenCalledWith('ui');
    });

    it('does NOT mark dirty when called with same value', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      handlers['showCutCopyIndicator'](false);
      markDirty.mockClear();
      handlers['showCutCopyIndicator'](false);
      expect(markDirty).not.toHaveBeenCalled();
    });
  });
});

describe('Theme guard — marks 4 layers on change', () => {
  it('marks cells, selection, headers, background on theme change', () => {
    const { markDirty, handlers } = createFakeForFieldHandlers();
    const theme1 = { name: 'dark' };
    handlers['theme'](theme1);
    expect(markDirty).toHaveBeenCalledWith('cells');
    expect(markDirty).toHaveBeenCalledWith('selection');
    expect(markDirty).toHaveBeenCalledWith('headers');
    expect(markDirty).toHaveBeenCalledWith('background');
    expect(markDirty).toHaveBeenCalledTimes(4);
  });

  it('does NOT mark dirty when same theme reference is set again', () => {
    const { markDirty, handlers } = createFakeForFieldHandlers();
    const theme1 = { name: 'dark' };
    handlers['theme'](theme1);
    markDirty.mockClear();
    // Same reference
    handlers['theme'](theme1);
    expect(markDirty).not.toHaveBeenCalled();
  });

  it('marks 4 layers when a different theme reference is set', () => {
    const { markDirty, handlers } = createFakeForFieldHandlers();
    const theme1 = { name: 'dark' };
    const theme2 = { name: 'light' };
    handlers['theme'](theme1);
    markDirty.mockClear();
    handlers['theme'](theme2);
    expect(markDirty).toHaveBeenCalledTimes(4);
  });
});

describe('Category C — state guards (reference identity)', () => {
  describe('grouping handlers (getGroupingConfig)', () => {
    it('marks headers dirty when function reference changes', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      const fn1 = () => null;
      handlers['getGroupingConfig'](fn1);
      expect(markDirty).toHaveBeenCalledWith('headers');
    });

    it('does NOT mark dirty when same reference is passed again', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      const fn1 = () => null;
      handlers['getGroupingConfig'](fn1);
      markDirty.mockClear();
      // Same reference
      handlers['getGroupingConfig'](fn1);
      expect(markDirty).not.toHaveBeenCalled();
    });

    it('marks dirty when a different reference is passed', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      const fn1 = () => null;
      const fn2 = () => null;
      handlers['getGroupingConfig'](fn1);
      markDirty.mockClear();
      handlers['getGroupingConfig'](fn2);
      expect(markDirty).toHaveBeenCalledWith('headers');
    });
  });

  describe('grouping handlers (getRowGroups)', () => {
    it('marks headers dirty when function reference changes', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      const fn1 = () => [] as any;
      handlers['getRowGroups'](fn1);
      expect(markDirty).toHaveBeenCalledWith('headers');
    });

    it('does NOT mark dirty when same reference is passed again', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      const fn1 = () => [] as any;
      handlers['getRowGroups'](fn1);
      markDirty.mockClear();
      handlers['getRowGroups'](fn1);
      expect(markDirty).not.toHaveBeenCalled();
    });
  });

  describe('page break handlers (pageBreaks)', () => {
    it('marks pageBreaks dirty when reference changes', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      const breaks1 = {
        rowBreaks: [{ id: 10, min: 0, max: 16383, manual: true, pt: false }],
        colBreaks: [{ id: 5, min: 0, max: 16383, manual: true, pt: false }],
      };
      handlers['pageBreaks'](breaks1);
      expect(markDirty).toHaveBeenCalledWith('pageBreaks');
    });

    it('does NOT mark dirty when same reference is passed again', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      const breaks1 = {
        rowBreaks: [{ id: 10, min: 0, max: 16383, manual: true, pt: false }],
        colBreaks: [{ id: 5, min: 0, max: 16383, manual: true, pt: false }],
      };
      handlers['pageBreaks'](breaks1);
      markDirty.mockClear();
      handlers['pageBreaks'](breaks1);
      expect(markDirty).not.toHaveBeenCalled();
    });

    it('marks dirty when a different reference is passed', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      const breaks1 = {
        rowBreaks: [{ id: 10, min: 0, max: 16383, manual: true, pt: false }],
        colBreaks: [{ id: 5, min: 0, max: 16383, manual: true, pt: false }],
      };
      const breaks2 = {
        rowBreaks: [{ id: 20, min: 0, max: 16383, manual: true, pt: false }],
        colBreaks: [{ id: 15, min: 0, max: 16383, manual: true, pt: false }],
      };
      handlers['pageBreaks'](breaks1);
      markDirty.mockClear();
      handlers['pageBreaks'](breaks2);
      expect(markDirty).toHaveBeenCalledWith('pageBreaks');
    });
  });

  describe('page break handlers (autoPageBreaks)', () => {
    it('does NOT mark dirty when same reference is passed again', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      const autoBreaks = {
        rowBreaks: [{ id: 100, min: 0, max: 16383, manual: false, pt: false }],
        colBreaks: [] as any[],
      };
      handlers['autoPageBreaks'](autoBreaks);
      markDirty.mockClear();
      handlers['autoPageBreaks'](autoBreaks);
      expect(markDirty).not.toHaveBeenCalled();
    });
  });

  describe('page break handlers (pageBreakPreviewMode)', () => {
    it('marks pageBreaks dirty on change from false to true', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      handlers['pageBreakPreviewMode'](true);
      expect(markDirty).toHaveBeenCalledWith('pageBreaks');
    });

    it('does NOT mark dirty when same value', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      handlers['pageBreakPreviewMode'](true);
      markDirty.mockClear();
      handlers['pageBreakPreviewMode'](true);
      expect(markDirty).not.toHaveBeenCalled();
    });
  });

  describe('trace arrow handlers', () => {
    it('marks traceArrows dirty when reference changes', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      const arrows1 = [{ id: 'a1' }];
      handlers['traceArrows'](arrows1);
      expect(markDirty).toHaveBeenCalledWith('traceArrows');
    });

    it('does NOT mark dirty when same reference is passed again', () => {
      const { markDirty, handlers } = createFakeForFieldHandlers();
      const arrows1 = [{ id: 'a1' }];
      handlers['traceArrows'](arrows1);
      markDirty.mockClear();
      handlers['traceArrows'](arrows1);
      expect(markDirty).not.toHaveBeenCalled();
    });
  });
});
