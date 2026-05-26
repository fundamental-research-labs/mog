/**
 * Renderer-facing SheetView skin contracts.
 *
 * These DTOs are the resolved visual state that canvas/grid-renderer can
 * consume directly. They intentionally do not import from `views/sheet-view`;
 * view-layer public DTOs should be mapped into these contracts at the boundary.
 *
 * @module @mog-sdk/contracts/rendering/sheet-view-skin
 */

import type { ChromeTheme } from './data-source-types';
import { DEFAULT_CHROME_THEME } from './data-source-types';

/**
 * Color mode after host/app preference resolution.
 *
 * `system` is retained for callers that intentionally defer OS preference
 * resolution to the renderer host boundary.
 */
export type SheetViewSkinColorScheme = 'light' | 'dark' | 'system';

/**
 * Density hint for renderer chrome metrics.
 */
export type SheetViewSkinDensity = 'compact' | 'comfortable';

/**
 * Motion preference after accessibility/host preference resolution.
 */
export type SheetViewSkinMotion = 'normal' | 'reduced';

/**
 * Resolved view options that affect sheet painting.
 *
 * This is a rendering DTO, not the persisted SheetViewOptions contract. All
 * fields are concrete so renderers do not need view-layer defaults.
 */
export interface ResolvedSheetViewOptions {
  /** Whether gridlines are visible. */
  readonly showGridlines: boolean;
  /** Whether row headers (1, 2, 3...) are visible. */
  readonly showRowHeaders: boolean;
  /** Whether column headers (A, B, C...) are visible. */
  readonly showColumnHeaders: boolean;
  /** Whether the sheet is displayed right-to-left. */
  readonly rightToLeft: boolean;
  /** Whether formulas are displayed instead of computed values. */
  readonly showFormulas: boolean;
  /** Whether zero values are displayed. */
  readonly showZeroValues: boolean;
  /** Zoom scale as a percentage. */
  readonly zoomScale: number;
  /** Effective gridline color used when gridlines are visible. */
  readonly gridlineColor: string;
}

/**
 * Resolved chrome colors for sheet rendering.
 *
 * Alias kept in this module so renderer code can import the skin slice without
 * reaching into viewport-owned data-source primitives.
 */
export type ResolvedSheetChromeTheme = ChromeTheme;

/**
 * Partial chrome theme patch accepted by resolution/boundary code.
 */
export type SheetChromeThemePatch = Partial<ResolvedSheetChromeTheme>;

export type ResolvedSheetViewColor = string;

export interface ResolvedSheetViewBackgroundSkin {
  readonly kind: 'color' | 'transparent';
  readonly color: ResolvedSheetViewColor;
  readonly opacity: number;
}

export interface ResolvedSheetViewGridlineJitter {
  readonly amplitudePx: number;
  readonly seed: string;
}

export interface ResolvedSheetViewGridlineSkin {
  readonly kind: 'hidden' | 'solid' | 'double';
  readonly color: ResolvedSheetViewColor;
  readonly width: number;
  readonly opacity: number;
  readonly dash: readonly number[];
  readonly lineCap: CanvasLineCap;
  readonly majorEveryRows: number | null;
  readonly majorEveryCols: number | null;
  readonly majorColor: ResolvedSheetViewColor;
  readonly majorWidth: number;
  readonly jitter: ResolvedSheetViewGridlineJitter | null;
}

export interface ResolvedSheetViewHeaderSkin {
  readonly background: ResolvedSheetViewColor;
  readonly textColor: ResolvedSheetViewColor;
  readonly borderColor: ResolvedSheetViewColor;
  readonly selectedBackground: ResolvedSheetViewColor;
  readonly selectedTextColor: ResolvedSheetViewColor;
  readonly fontFamily: string | null;
  readonly fontSizePx: number | null;
  readonly fontWeight: string | number | null;
}

export interface ResolvedSheetViewSelectionGlowSkin {
  readonly color: ResolvedSheetViewColor;
  readonly blurPx: number;
  readonly opacity: number;
}

export interface ResolvedSheetViewSelectionHandleSkin {
  readonly color: ResolvedSheetViewColor;
  readonly borderColor: ResolvedSheetViewColor;
  readonly shape: 'square' | 'circle' | 'diamond';
  readonly sizePx: number | null;
}

export interface ResolvedSheetViewSelectionSkin {
  readonly fill: ResolvedSheetViewColor;
  readonly border: ResolvedSheetViewColor;
  readonly activeBorder: ResolvedSheetViewColor;
  readonly borderWidth: number;
  readonly glow: ResolvedSheetViewSelectionGlowSkin | null;
  readonly handle: ResolvedSheetViewSelectionHandleSkin;
}

export interface ResolvedSheetViewScrollbarSkin {
  readonly thumb: ResolvedSheetViewColor;
  readonly track: ResolvedSheetViewColor;
  readonly hoverThumb: ResolvedSheetViewColor;
  readonly activeThumb: ResolvedSheetViewColor;
  readonly widthPx: number | null;
}

export interface ResolvedSheetViewFormulaReferenceSkin {
  readonly stroke: ResolvedSheetViewColor;
  readonly fill: ResolvedSheetViewColor;
}

export interface ResolvedSheetViewControlIndicatorSkin {
  readonly commentIndicator: ResolvedSheetViewColor;
  readonly validationDropdown: ResolvedSheetViewColor;
  readonly validationError: ResolvedSheetViewColor;
  readonly filterIcon: ResolvedSheetViewColor;
  readonly filterActiveIcon: ResolvedSheetViewColor;
  readonly checkboxBorder: ResolvedSheetViewColor;
  readonly checkboxCheck: ResolvedSheetViewColor;
  readonly checkboxBackground: ResolvedSheetViewColor;
  readonly autofillHandle: ResolvedSheetViewColor;
  readonly frozenPaneDivider: ResolvedSheetViewColor;
  readonly hiddenIndicator: ResolvedSheetViewColor;
}

export interface ResolvedSheetViewOverlaySkin {
  readonly pastePreviewFill: ResolvedSheetViewColor;
  readonly pastePreviewBorder: ResolvedSheetViewColor;
  readonly searchHighlightFill: ResolvedSheetViewColor;
  readonly searchHighlightBorder: ResolvedSheetViewColor;
  readonly dragGhostFill: ResolvedSheetViewColor;
  readonly dragGhostBorder: ResolvedSheetViewColor;
  readonly errorFill: ResolvedSheetViewColor;
  readonly errorBorder: ResolvedSheetViewColor;
}

/**
 * Complete renderer-facing skin for a SheetView.
 */
export interface ResolvedSheetViewSkin {
  /** Stable identifier for cache keys and diagnostics. */
  readonly skinId: string;
  /** Color scheme after host/app resolution. */
  readonly colorScheme: SheetViewSkinColorScheme;
  /** Renderer chrome density. */
  readonly density: SheetViewSkinDensity;
  /** Motion preference for transient renderer effects. */
  readonly motion: SheetViewSkinMotion;
  /** Concrete sheet view options for paint decisions. */
  readonly viewOptions: ResolvedSheetViewOptions;
  /** Concrete chrome colors for canvas and grid renderer layers. */
  readonly chromeTheme: ResolvedSheetChromeTheme;
  readonly background: ResolvedSheetViewBackgroundSkin;
  /** Background for workbook no-fill/default cells and merged-cell base paint. */
  readonly defaultCellBackground: ResolvedSheetViewColor;
  /** Text color for automatic/default cell text generated by the renderer. */
  readonly defaultCellText: ResolvedSheetViewColor;
  /** Secondary generated text color for disabled/placeholder renderer text. */
  readonly mutedCellText: ResolvedSheetViewColor;
  readonly gridlines: ResolvedSheetViewGridlineSkin;
  readonly headers: ResolvedSheetViewHeaderSkin;
  readonly selection: ResolvedSheetViewSelectionSkin;
  readonly scrollbars: ResolvedSheetViewScrollbarSkin;
  readonly formulaRefColors: readonly ResolvedSheetViewFormulaReferenceSkin[];
  readonly controls: ResolvedSheetViewControlIndicatorSkin;
  readonly overlays: ResolvedSheetViewOverlaySkin;
}

/**
 * Input DTO for callers that have not yet resolved every field.
 */
export interface SheetViewSkinPatch {
  readonly skinId?: string;
  readonly colorScheme?: SheetViewSkinColorScheme;
  readonly density?: SheetViewSkinDensity;
  readonly motion?: SheetViewSkinMotion;
  readonly viewOptions?: Partial<ResolvedSheetViewOptions>;
  readonly chromeTheme?: SheetChromeThemePatch;
  readonly background?: Partial<ResolvedSheetViewBackgroundSkin>;
  readonly defaultCellBackground?: ResolvedSheetViewColor;
  readonly defaultCellText?: ResolvedSheetViewColor;
  readonly mutedCellText?: ResolvedSheetViewColor;
  readonly gridlines?: Partial<ResolvedSheetViewGridlineSkin>;
  readonly headers?: Partial<ResolvedSheetViewHeaderSkin>;
  readonly selection?: Partial<ResolvedSheetViewSelectionSkin>;
  readonly scrollbars?: Partial<ResolvedSheetViewScrollbarSkin>;
  readonly formulaRefColors?: readonly Partial<ResolvedSheetViewFormulaReferenceSkin>[];
  readonly controls?: Partial<ResolvedSheetViewControlIndicatorSkin>;
  readonly overlays?: Partial<ResolvedSheetViewOverlaySkin>;
}

export const DEFAULT_RESOLVED_SHEET_VIEW_OPTIONS: ResolvedSheetViewOptions = {
  showGridlines: true,
  showRowHeaders: true,
  showColumnHeaders: true,
  rightToLeft: false,
  showFormulas: false,
  showZeroValues: true,
  zoomScale: 100,
  gridlineColor: DEFAULT_CHROME_THEME.gridlineColor,
};

export const DEFAULT_RESOLVED_SHEET_VIEW_SKIN: ResolvedSheetViewSkin = {
  skinId: 'default',
  colorScheme: 'light',
  density: 'comfortable',
  motion: 'normal',
  viewOptions: DEFAULT_RESOLVED_SHEET_VIEW_OPTIONS,
  chromeTheme: DEFAULT_CHROME_THEME,
  background: {
    kind: 'color',
    color: DEFAULT_CHROME_THEME.canvasBackground,
    opacity: 1,
  },
  defaultCellBackground: DEFAULT_CHROME_THEME.canvasBackground,
  defaultCellText: '#202124',
  mutedCellText: '#5f6368',
  gridlines: {
    kind: 'solid',
    color: DEFAULT_CHROME_THEME.gridlineColor,
    width: 1,
    opacity: 1,
    dash: [],
    lineCap: 'butt',
    majorEveryRows: null,
    majorEveryCols: null,
    majorColor: DEFAULT_CHROME_THEME.gridlineColor,
    majorWidth: 1,
    jitter: null,
  },
  headers: {
    background: DEFAULT_CHROME_THEME.headerBackground,
    textColor: DEFAULT_CHROME_THEME.headerText,
    borderColor: DEFAULT_CHROME_THEME.headerBorder,
    selectedBackground: DEFAULT_CHROME_THEME.headerHighlightBackground,
    selectedTextColor: DEFAULT_CHROME_THEME.headerHighlightText,
    fontFamily: null,
    fontSizePx: null,
    fontWeight: null,
  },
  selection: {
    fill: DEFAULT_CHROME_THEME.selectionFill,
    border: DEFAULT_CHROME_THEME.selectionBorder,
    activeBorder: DEFAULT_CHROME_THEME.activeCellBorder,
    borderWidth: 2,
    glow: null,
    handle: {
      color: DEFAULT_CHROME_THEME.fillHandleColor,
      borderColor: DEFAULT_CHROME_THEME.activeCellBorder,
      shape: 'square',
      sizePx: null,
    },
  },
  scrollbars: {
    thumb: DEFAULT_CHROME_THEME.scrollbarThumb,
    track: DEFAULT_CHROME_THEME.scrollbarTrack,
    hoverThumb: DEFAULT_CHROME_THEME.scrollbarThumb,
    activeThumb: DEFAULT_CHROME_THEME.scrollbarThumb,
    widthPx: null,
  },
  formulaRefColors: [
    { stroke: '#1a73e8', fill: 'rgba(26, 115, 232, 0.12)' },
    { stroke: '#d93025', fill: 'rgba(217, 48, 37, 0.12)' },
    { stroke: '#188038', fill: 'rgba(24, 128, 56, 0.12)' },
    { stroke: '#f9ab00', fill: 'rgba(249, 171, 0, 0.16)' },
    { stroke: '#9334e6', fill: 'rgba(147, 52, 230, 0.12)' },
    { stroke: '#00acc1', fill: 'rgba(0, 172, 193, 0.12)' },
  ],
  controls: {
    commentIndicator: '#d93025',
    validationDropdown: 'rgba(32, 33, 36, 0.62)',
    validationError: '#d93025',
    filterIcon: 'rgba(32, 33, 36, 0.62)',
    filterActiveIcon: '#1a73e8',
    checkboxBorder: '#5f6368',
    checkboxCheck: DEFAULT_CHROME_THEME.activeCellBorder,
    checkboxBackground: DEFAULT_CHROME_THEME.canvasBackground,
    autofillHandle: DEFAULT_CHROME_THEME.fillHandleColor,
    frozenPaneDivider: '#80868b',
    hiddenIndicator: '#999999',
  },
  overlays: {
    pastePreviewFill: 'rgba(33, 115, 70, 0.10)',
    pastePreviewBorder: DEFAULT_CHROME_THEME.selectionBorder,
    searchHighlightFill: 'rgba(251, 188, 4, 0.32)',
    searchHighlightBorder: '#f9ab00',
    dragGhostFill: DEFAULT_CHROME_THEME.dragSourceColor,
    dragGhostBorder: DEFAULT_CHROME_THEME.dragTargetColor,
    errorFill: 'rgba(217, 48, 37, 0.10)',
    errorBorder: '#d93025',
  },
};
