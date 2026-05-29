/**
 * Ribbon visibility config.
 *
 * The config mirrors the visible ribbon hierarchy:
 * tab -> group -> button. Any node can be a boolean, where `false`
 * hides that node and all descendants and `true` shows the node and all
 * descendants regardless of lower-profile defaults.
 */

export const RIBBON_VISIBILITY_SCHEMA = {
  home: {
    clipboard: {
      paste: true,
      cut: true,
      copy: true,
      formatPainter: true,
    },
    font: {
      fontFamily: true,
      fontSize: true,
      increaseFontSize: true,
      decreaseFontSize: true,
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      fontColor: true,
      fillColor: true,
      borders: true,
      clearFormatting: true,
      dialogLauncher: true,
    },
    alignment: {
      topAlign: true,
      middleAlign: true,
      bottomAlign: true,
      alignLeft: true,
      center: true,
      alignRight: true,
      orientation: true,
      wrapText: true,
      mergeCenter: true,
      decreaseIndent: true,
      increaseIndent: true,
      dialogLauncher: true,
    },
    number: {
      numberFormat: true,
      accountingNumberFormat: true,
      percentStyle: true,
      commaStyle: true,
      increaseDecimal: true,
      decreaseDecimal: true,
      dialogLauncher: true,
    },
    styles: {
      conditionalFormatting: true,
      formatAsTable: true,
      cellStyles: true,
      dialogLauncher: true,
    },
    cells: {
      insert: true,
      delete: true,
      format: true,
      dialogLauncher: true,
    },
    editing: {
      autoSum: true,
      fill: true,
      clear: true,
      sortFilter: true,
      findSelect: true,
    },
  },
  insert: {
    tables: {
      pivotTable: true,
      table: true,
      checkBox: true,
      comboBox: true,
    },
    illustrations: {
      pictures: true,
      shapes: true,
      diagram: true,
      icons: true,
      '3dModels': true,
      models: true,
      smartArt: true,
      screenshot: true,
    },
    charts: {
      charts: true,
      recommendedCharts: true,
      moreCharts: true,
      columnBar: true,
      column: true,
      bar: true,
      lineArea: true,
      line: true,
      area: true,
      pieDoughnut: true,
      pie: true,
      hierarchy: true,
      treemap: true,
      sunburst: true,
      statistical: true,
      histogram: true,
      scatterBubble: true,
      scatter: true,
      bubble: true,
      waterfallStockSurfaceRadar: true,
      waterfall: true,
      stock: true,
      surface: true,
      radar: true,
      combo: true,
      funnel: true,
      regionMap: true,
      pivotChart: true,
    },
    sparklines: {
      sparklines: true,
      line: true,
      column: true,
      winLoss: true,
    },
    filters: {
      slicer: true,
      filterControl: true,
      timeline: true,
      dateFilter: true,
    },
    links: {
      link: true,
    },
    comments: {
      comment: true,
    },
    text: {
      textBox: true,
      headerFooter: true,
      wordArt: true,
      textEffects: true,
      signatureLine: true,
      object: true,
      equation: true,
    },
  },
  pageLayout: {
    themes: {
      themes: true,
      themeColors: true,
      themeFonts: true,
    },
    pageSetup: {
      margins: true,
      orientation: true,
      size: true,
      printArea: true,
      breaks: true,
      printTitles: true,
      dialogLauncher: true,
    },
    scaleToFit: {
      width: true,
      height: true,
      scale: true,
    },
    sheetOptions: {
      gridlinesView: true,
      gridlinesPrint: true,
      headingsView: true,
      headingsPrint: true,
    },
    arrange: {
      bringForward: true,
      bringToFront: true,
      sendBackward: true,
      sendToBack: true,
      selectionPane: true,
      align: true,
      group: true,
      ungroup: true,
      rotate: true,
    },
  },
  formulas: {
    functionLibrary: {
      insertFunction: true,
      autoSum: true,
      recentlyUsed: true,
      financial: true,
      logical: true,
      text: true,
      dateTime: true,
      lookup: true,
      mathTrig: true,
      moreFunctions: true,
    },
    definedNames: {
      nameManager: true,
      defineName: true,
      useInFormula: true,
      createFromSelection: true,
    },
    formulaAuditing: {
      tracePrecedents: true,
      traceDependents: true,
      removeArrows: true,
      showFormulas: true,
      errorChecking: true,
      evaluateFormula: true,
      watchWindow: true,
    },
    calculation: {
      calculationOptions: true,
      calculateNow: true,
      calculateSheet: true,
    },
  },
  data: {
    importData: {
      getData: true,
      importData: true,
    },
    queriesConnections: {
      refreshAll: true,
      queriesConnections: true,
      properties: true,
      editLinks: true,
    },
    sortFilter: {
      sortAscending: true,
      sortAZ: true,
      sortDescending: true,
      sortZA: true,
      sort: true,
      customSort: true,
      filter: true,
      clear: true,
      reapply: true,
      advanced: true,
    },
    dataTools: {
      textToColumns: true,
      flashFill: true,
      removeDuplicates: true,
      dataValidation: true,
      validation: true,
      circleInvalid: true,
      clearCircles: true,
      consolidate: true,
      relationships: true,
      manageDataModel: true,
    },
    forecast: {
      whatIfAnalysis: true,
      scenarios: true,
      forecastSheet: true,
    },
    outline: {
      group: true,
      ungroup: true,
      subtotal: true,
      subtotals: true,
      showDetail: true,
      show: true,
      hideDetail: true,
      hide: true,
    },
  },
  review: {
    proofing: {
      spelling: true,
      thesaurus: true,
      workbookStatistics: true,
    },
    accessibility: {
      checkAccessibility: true,
    },
    comments: {
      newComment: true,
      delete: true,
      previous: true,
      next: true,
      showHideComment: true,
      showComments: true,
      showInk: true,
    },
    protect: {
      protectSheet: true,
      protectWorkbook: true,
      allowEditRanges: true,
      alwaysOpenReadOnly: true,
    },
  },
  view: {
    workbookViews: {
      normal: true,
      pageBreakPreview: true,
      pageLayout: true,
      customViews: true,
    },
    show: {
      ruler: true,
      gridlines: true,
      formulaBar: true,
      headings: true,
      horizontalScrollbar: true,
      verticalScrollbar: true,
    },
    zoom: {
      zoom: true,
      oneHundredPercent: true,
      zoomOut: true,
      zoomIn: true,
      zoomToSelection: true,
    },
    window: {
      newWindow: true,
      arrangeAll: true,
      freezePanes: true,
      split: true,
      hide: true,
      unhide: true,
      switchWindows: true,
    },
    macros: {
      macros: true,
      recordMacro: true,
      useRelativeReferences: true,
      macroSecurity: true,
    },
    settings: {
      spreadSettings: true,
      appearance: true,
      workbook: true,
      sheetSettings: true,
      sheet: true,
    },
    panels: {
      formulaBar: true,
      statusBar: true,
      side: true,
      comments: true,
      find: true,
    },
  },
  tableDesign: {
    tableProperties: {
      tableName: true,
      resizeTable: true,
    },
    tools: {
      summarizeWithPivotTable: true,
      removeDuplicates: true,
      convertToRange: true,
      insertSlicer: true,
      delete: true,
    },
    externalTableData: {
      refresh: true,
      properties: true,
    },
    tableStyleOptions: {
      headerRow: true,
      totalRow: true,
      bandedRows: true,
      firstColumn: true,
      lastColumn: true,
      bandedColumns: true,
      filterButton: true,
    },
    tableStyles: {
      styleGallery: true,
    },
  },
  chartDesign: {
    type: {
      changeType: true,
    },
    data: {
      selectData: true,
      switchRowColumn: true,
    },
    chartElements: {
      chartTitle: true,
      legend: true,
    },
    arrange: {
      bringToFront: true,
      sendToBack: true,
      bringForward: true,
      sendBackward: true,
    },
    actions: {
      delete: true,
    },
  },
  pictureTools: {
    adjust: {
      brightness: true,
      contrast: true,
      reset: true,
    },
    arrange: {
      bringToFront: true,
      sendToBack: true,
      bringForward: true,
      sendBackward: true,
    },
    size: {
      width: true,
      height: true,
      lockAspectRatio: true,
    },
    actions: {
      delete: true,
    },
  },
  slicerTools: {
    filterControl: {
      settings: true,
      reportConnections: true,
    },
    filterControlStyles: {
      styles: true,
    },
    buttons: {
      columns: true,
      buttonHeight: true,
      buttonWidth: true,
    },
    size: {
      sizeProperties: true,
      remove: true,
    },
  },
  sparklineTools: {
    type: {
      type: true,
    },
    show: {
      highPoint: true,
      lowPoint: true,
      firstPoint: true,
      lastPoint: true,
      negativePoints: true,
      markers: true,
    },
    group: {
      group: true,
      ungroup: true,
      clear: true,
    },
  },
  diagramDesign: {
    createGraphic: {
      addShape: true,
    },
    layouts: {
      changeLayout: true,
    },
    diagramStyles: {
      quickStyles: true,
      changeColors: true,
    },
    reset: {
      resetGraphic: true,
      convertToShapes: true,
    },
    actions: {
      delete: true,
    },
  },
  diagramFormat: {
    shapeStyles: {
      shapeFill: true,
      shapeOutline: true,
      shapeEffects: true,
    },
    textEffectsStyles: {
      bold: true,
      italic: true,
      textFill: true,
      textOutline: true,
      textEffects: true,
    },
    arrange: {
      bringForward: true,
      sendBackward: true,
      selectionPane: true,
      align: true,
      group: true,
      ungroup: true,
      rotate: true,
    },
    size: {
      height: true,
      width: true,
    },
  },
  formulaBar: {
    controls: {
      nameBox: true,
      cancelEdit: true,
      confirmEdit: true,
      insertFunction: true,
      hideFormulaBar: true,
      toggleAiFormulaBar: true,
      expandCollapse: true,
    },
  },
  nlFormulaBar: {
    generate: {
      generate: true,
      explain: true,
    },
    result: {
      accept: true,
      retry: true,
      dismiss: true,
    },
    explain: {
      retry: true,
      dismiss: true,
    },
  },
  collaboration: {
    tabBar: {
      avatars: true,
      collaborate: true,
    },
    popover: {
      copyLink: true,
      stopCollaborating: true,
    },
  },
} as const;

type VisibilityNode<T> = T extends boolean
  ? boolean
  : boolean | { readonly [K in keyof T]?: VisibilityNode<T[K]> };

export type RibbonVisibilityConfig = {
  readonly [K in keyof typeof RIBBON_VISIBILITY_SCHEMA]?: VisibilityNode<
    (typeof RIBBON_VISIBILITY_SCHEMA)[K]
  >;
};

export type RibbonVisibilityRootKey = keyof typeof RIBBON_VISIBILITY_SCHEMA;

type RibbonVisibilityChromeSurfaceKey = 'formulaBar' | 'nlFormulaBar' | 'collaboration';

export type RibbonVisibilityTabKey = Exclude<
  RibbonVisibilityRootKey,
  RibbonVisibilityChromeSurfaceKey
>;

export type RibbonVisibilityGroupKey<Tab extends RibbonVisibilityTabKey> = Extract<
  keyof Exclude<(typeof RIBBON_VISIBILITY_SCHEMA)[Tab], boolean>,
  string
>;

export type RibbonVisibilityButtonKey<
  Tab extends RibbonVisibilityTabKey,
  Group extends RibbonVisibilityGroupKey<Tab>,
> = Extract<
  keyof Exclude<Exclude<(typeof RIBBON_VISIBILITY_SCHEMA)[Tab], boolean>[Group], boolean>,
  string
>;

export type RibbonVisibilityProfileName = 'public' | 'app-eval' | 'all';

export type RibbonVisibilityPath = readonly [RibbonVisibilityRootKey, string?, string?];

export const PUBLIC_RIBBON_VISIBILITY_CONFIG = {
  insert: {
    tables: {
      pivotTable: false,
      checkBox: false,
      comboBox: false,
    },
    illustrations: false,
    sparklines: false,
    filters: false,
    text: false,
  },
  pageLayout: false,
} satisfies RibbonVisibilityConfig;

export const APP_EVAL_RIBBON_VISIBILITY_CONFIG = {
  home: true,
  insert: true,
  pageLayout: true,
  formulas: true,
  data: true,
  review: true,
  view: true,
  tableDesign: true,
  chartDesign: true,
  pictureTools: true,
  slicerTools: true,
  sparklineTools: true,
  diagramDesign: true,
  diagramFormat: true,
  formulaBar: true,
  nlFormulaBar: true,
  collaboration: true,
} satisfies RibbonVisibilityConfig;

export const RIBBON_VISIBILITY_PROFILES = {
  public: PUBLIC_RIBBON_VISIBILITY_CONFIG,
  'app-eval': APP_EVAL_RIBBON_VISIBILITY_CONFIG,
  all: APP_EVAL_RIBBON_VISIBILITY_CONFIG,
} as const satisfies Record<RibbonVisibilityProfileName, RibbonVisibilityConfig>;

export function getRibbonVisibilityProfile(
  name: string | undefined | null,
): RibbonVisibilityConfig {
  if (name === 'app-eval' || name === 'all' || name === 'public') {
    return RIBBON_VISIBILITY_PROFILES[name];
  }
  return PUBLIC_RIBBON_VISIBILITY_CONFIG;
}

export function mergeRibbonVisibilityConfig(
  base: RibbonVisibilityConfig | undefined,
  override: RibbonVisibilityConfig | undefined,
): RibbonVisibilityConfig {
  if (!base) return override ?? {};
  if (!override) return base;
  return mergeVisibilityObject(base, override) as RibbonVisibilityConfig;
}

function mergeVisibilityObject(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = next[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      next[key] = mergeVisibilityObject(baseValue, overrideValue);
    } else {
      next[key] = overrideValue;
    }
  }
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isRibbonPathVisible(
  config: RibbonVisibilityConfig | undefined,
  path: RibbonVisibilityPath,
): boolean {
  let cursor: unknown = config;
  for (const key of path) {
    if (!key) break;
    if (cursor === false) return false;
    if (cursor === true || cursor == null) return true;
    if (!isPlainObject(cursor)) return true;
    cursor = cursor[key];
  }
  return cursor !== false;
}

export function normalizeRibbonVisibilityKey(value: string | undefined | null): string | null {
  if (!value) return null;
  const withoutShortcut = value.split('(')[0] ?? value;
  const withoutPrefix = withoutShortcut
    .trim()
    .replace(/^ribbon-(button|dropdown|menu)-/i, '')
    .replace(/^ribbon-/i, '')
    .replace(/&/g, ' ')
    .replace(/\+/g, ' plus ')
    .replace(/%/g, ' percent ');
  const words = withoutPrefix.match(/[A-Za-z0-9]+/g);
  if (!words?.length) return null;
  const [first, ...rest] = words;
  const normalized = [
    first.toLowerCase(),
    ...rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()),
  ].join('');
  return RIBBON_VISIBILITY_KEY_ALIASES[normalized] ?? normalized;
}

const RIBBON_VISIBILITY_KEY_ALIASES: Record<string, string> = {
  wordWrap: 'wrapText',
  alignTop: 'topAlign',
  alignMiddle: 'middleAlign',
  alignBottom: 'bottomAlign',
  currencyFormat: 'accountingNumberFormat',
  percentFormat: 'percentStyle',
  commaFormat: 'commaStyle',
  increaseDecimalPlaces: 'increaseDecimal',
  decreaseDecimalPlaces: 'decreaseDecimal',
};
