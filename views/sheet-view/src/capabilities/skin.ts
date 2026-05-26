/**
 * Skin Capability Implementation
 *
 * Owns the public SheetViewSkin lifecycle for the view layer. Renderer-native
 * skin plumbing is intentionally not implemented here; until that exists, this
 * capability stores the current public skin, emits lifecycle events, and
 * invalidates the existing renderer so default behavior stays unchanged.
 *
 * @module @mog-sdk/sheet-view/capabilities/skin
 */

import { DEFAULT_CHROME_THEME, type ChromeTheme } from '@mog-sdk/contracts/rendering';
import {
  DEFAULT_RESOLVED_SHEET_VIEW_SKIN,
  type ResolvedSheetViewSkin,
} from '@mog-sdk/contracts/rendering/sheet-view-skin';

import type { ISheetViewSkin } from '../capability-interfaces';
import type {
  SheetDisposable,
  SheetChromeTheme,
  SheetViewOptions,
  SheetViewResolvedSkin,
  SheetViewSkin,
  SheetViewSkinEvent,
  SheetViewSkinColor,
} from '../public-types';

// =============================================================================
// Internal accessor type
// =============================================================================

export interface SkinInternals {
  invalidate(): void;
  updateResolvedSkin(skin: ResolvedSheetViewSkin): void;
}

export interface SkinResolutionInputs {
  readonly skin: SheetViewSkin | null;
  readonly colorScheme?: 'light' | 'dark';
  readonly chromeTheme?: SheetChromeTheme | ChromeTheme;
  readonly viewOptions?: SheetViewOptions;
}

const CHROME_TOKEN_KEYS = new Set<keyof ChromeTheme>([
  'canvasBackground',
  'gridlineColor',
  'headerBackground',
  'headerText',
  'headerBorder',
  'headerHighlightBackground',
  'headerHighlightText',
  'selectionFill',
  'selectionBorder',
  'activeCellBorder',
  'fillHandleColor',
  'dragSourceColor',
  'dragTargetColor',
  'scrollbarTrack',
  'scrollbarThumb',
]);

function isRendererChromeTheme(theme: SheetChromeTheme | ChromeTheme): theme is ChromeTheme {
  return 'canvasBackground' in theme;
}

export function mapSheetChromeThemeToRenderer(
  theme: SheetChromeTheme | ChromeTheme | undefined,
  base: ChromeTheme = DEFAULT_CHROME_THEME,
): ChromeTheme {
  if (!theme) return { ...base };
  if (isRendererChromeTheme(theme)) {
    return { ...base, ...theme };
  }
  return {
    ...base,
    canvasBackground: theme.background ?? base.canvasBackground,
    gridlineColor: theme.gridlineColor ?? base.gridlineColor,
    headerBackground: theme.headerBackground ?? base.headerBackground,
    headerText: theme.headerText ?? base.headerText,
    headerBorder: theme.headerBorder ?? base.headerBorder,
    headerHighlightBackground: theme.headerBackground ?? base.headerHighlightBackground,
    headerHighlightText: theme.headerText ?? base.headerHighlightText,
    selectionFill: theme.selectionBackground ?? base.selectionFill,
    selectionBorder: theme.selectionBorder ?? base.selectionBorder,
    activeCellBorder: theme.selectionBorder ?? base.activeCellBorder,
    fillHandleColor: theme.selectionBorder ?? base.fillHandleColor,
    scrollbarThumb: theme.scrollbarThumb ?? base.scrollbarThumb,
    scrollbarTrack: theme.scrollbarTrack ?? base.scrollbarTrack,
  };
}

function resolveColor(
  color: SheetViewSkinColor | undefined,
  chromeTheme: ChromeTheme,
  fallback: string,
): string {
  if (typeof color === 'string') return color;
  if (!color) return fallback;
  if (color.kind === 'theme-token') {
    const token = color.token as keyof ChromeTheme;
    if (CHROME_TOKEN_KEYS.has(token)) {
      return chromeTheme[token];
    }
    return color.fallback ?? fallback;
  }
  return fallback;
}

export function resolveSheetViewSkin(inputs: SkinResolutionInputs): ResolvedSheetViewSkin {
  const chromeTheme = mapSheetChromeThemeToRenderer(inputs.chromeTheme);
  const skin = inputs.skin;
  const colorScheme = skin?.colorScheme ?? inputs.colorScheme ?? 'light';
  const viewOptions = inputs.viewOptions;
  const base = DEFAULT_RESOLVED_SHEET_VIEW_SKIN;
  const gridlineColor = viewOptions?.gridlineColor ?? chromeTheme.gridlineColor;
  const showGridlines = viewOptions?.showGridlines ?? true;
  const gridlines = skin?.gridlines;
  const background = skin?.background;
  const headers = skin?.headers;
  const selection = skin?.selection;
  const scrollbars = skin?.scrollbars;
  const controls = skin?.controls;
  const overlays = skin?.overlays;

  const resolved: ResolvedSheetViewSkin = {
    ...base,
    skinId: skin?.id ?? (skin ? 'host-skin' : 'default'),
    colorScheme,
    viewOptions: {
      ...base.viewOptions,
      showGridlines,
      showRowHeaders: viewOptions?.showRowHeaders ?? true,
      showColumnHeaders: viewOptions?.showColumnHeaders ?? true,
      showZeroValues: viewOptions?.showZeroValues ?? true,
      rightToLeft: viewOptions?.rightToLeft ?? false,
      showFormulas: false,
      gridlineColor,
    },
    chromeTheme,
    background: {
      kind: background?.kind === 'transparent' ? 'transparent' : 'color',
      color:
        background?.kind === 'color'
          ? resolveColor(background.color, chromeTheme, chromeTheme.canvasBackground)
          : chromeTheme.canvasBackground,
      opacity:
        background?.kind === 'color' || background?.kind === 'image-pattern'
          ? (background.opacity ?? 1)
          : 1,
    },
    defaultCellBackground: resolveColor(
      skin?.defaultCellBackground,
      chromeTheme,
      colorScheme === 'dark' ? '#15191d' : chromeTheme.canvasBackground,
    ),
    defaultCellText: resolveColor(
      skin?.defaultCellText,
      chromeTheme,
      colorScheme === 'dark' ? '#f4f7f5' : base.defaultCellText,
    ),
    mutedCellText: resolveColor(
      skin?.mutedCellText,
      chromeTheme,
      colorScheme === 'dark' ? '#a9b5ae' : base.mutedCellText,
    ),
    gridlines: {
      ...base.gridlines,
      kind:
        gridlines?.kind === 'hidden' || !showGridlines
          ? 'hidden'
          : gridlines?.kind === 'styled' && gridlines.style === 'double'
            ? 'double'
            : 'solid',
      color:
        gridlines?.kind === 'styled'
          ? resolveColor(gridlines.color, chromeTheme, gridlineColor)
          : gridlineColor,
      width: gridlines?.kind === 'styled' ? (gridlines.width ?? 1) : 1,
      opacity: gridlines?.kind === 'styled' ? (gridlines.opacity ?? 1) : 1,
      dash:
        gridlines?.kind === 'styled'
          ? (gridlines.dash ??
            (gridlines.style === 'dashed' ? [4, 4] : gridlines.style === 'dotted' ? [1, 3] : []))
          : [],
      lineCap: gridlines?.kind === 'styled' ? (gridlines.lineCap ?? 'butt') : 'butt',
      majorEveryRows: gridlines?.kind === 'styled' ? (gridlines.majorEveryRows ?? null) : null,
      majorEveryCols: gridlines?.kind === 'styled' ? (gridlines.majorEveryCols ?? null) : null,
      majorColor:
        gridlines?.kind === 'styled'
          ? resolveColor(gridlines.majorColor, chromeTheme, gridlineColor)
          : gridlineColor,
      majorWidth: gridlines?.kind === 'styled' ? (gridlines.majorWidth ?? gridlines.width ?? 1) : 1,
      jitter:
        gridlines?.kind === 'styled' && gridlines.jitter
          ? {
              amplitudePx: gridlines.jitter.amplitudePx,
              seed: gridlines.jitter.seed ?? skin?.id ?? 'sheet-view',
            }
          : null,
    },
    headers: {
      background: resolveColor(headers?.background, chromeTheme, chromeTheme.headerBackground),
      textColor: resolveColor(headers?.textColor, chromeTheme, chromeTheme.headerText),
      borderColor: resolveColor(headers?.borderColor, chromeTheme, chromeTheme.headerBorder),
      selectedBackground: resolveColor(
        headers?.selectedBackground,
        chromeTheme,
        chromeTheme.headerHighlightBackground,
      ),
      selectedTextColor: resolveColor(
        headers?.selectedTextColor,
        chromeTheme,
        chromeTheme.headerHighlightText,
      ),
      fontFamily: headers?.fontFamily ?? null,
      fontSizePx: headers?.fontSizePx ?? null,
      fontWeight: headers?.fontWeight ?? null,
    },
    selection: {
      fill: resolveColor(selection?.fill, chromeTheme, chromeTheme.selectionFill),
      border: resolveColor(selection?.border, chromeTheme, chromeTheme.selectionBorder),
      activeBorder: resolveColor(
        selection?.activeBorder,
        chromeTheme,
        chromeTheme.activeCellBorder,
      ),
      borderWidth: selection?.borderWidth ?? 2,
      glow: selection?.glow
        ? {
            color: resolveColor(selection.glow.color, chromeTheme, chromeTheme.selectionBorder),
            blurPx: selection.glow.blurPx,
            opacity: selection.glow.opacity ?? 1,
          }
        : null,
      handle: {
        color: resolveColor(selection?.handle?.color, chromeTheme, chromeTheme.fillHandleColor),
        borderColor: resolveColor(
          selection?.handle?.borderColor,
          chromeTheme,
          chromeTheme.activeCellBorder,
        ),
        shape: selection?.handle?.shape ?? 'square',
        sizePx: selection?.handle?.sizePx ?? null,
      },
    },
    scrollbars: {
      thumb: resolveColor(scrollbars?.thumb, chromeTheme, chromeTheme.scrollbarThumb),
      track: resolveColor(scrollbars?.track, chromeTheme, chromeTheme.scrollbarTrack),
      hoverThumb: resolveColor(scrollbars?.hoverThumb, chromeTheme, chromeTheme.scrollbarThumb),
      activeThumb: resolveColor(scrollbars?.activeThumb, chromeTheme, chromeTheme.scrollbarThumb),
      widthPx: scrollbars?.widthPx ?? null,
    },
    formulaRefColors:
      skin?.formulaRefColors && skin.formulaRefColors.length > 0
        ? skin.formulaRefColors.map((entry, index) => ({
            stroke: resolveColor(
              entry.stroke,
              chromeTheme,
              base.formulaRefColors[index % base.formulaRefColors.length]?.stroke ??
                base.selection.border,
            ),
            fill: resolveColor(
              entry.fill,
              chromeTheme,
              base.formulaRefColors[index % base.formulaRefColors.length]?.fill ??
                base.selection.fill,
            ),
          }))
        : base.formulaRefColors,
    controls: {
      commentIndicator: resolveColor(
        controls?.commentIndicator,
        chromeTheme,
        base.controls.commentIndicator,
      ),
      validationDropdown: resolveColor(
        controls?.validationDropdown,
        chromeTheme,
        colorScheme === 'dark' ? 'rgba(244, 247, 245, 0.68)' : base.controls.validationDropdown,
      ),
      validationError: resolveColor(
        controls?.validationError,
        chromeTheme,
        base.controls.validationError,
      ),
      filterIcon: resolveColor(
        controls?.filterIcon,
        chromeTheme,
        colorScheme === 'dark' ? 'rgba(244, 247, 245, 0.68)' : base.controls.filterIcon,
      ),
      filterActiveIcon: resolveColor(
        controls?.filterActiveIcon,
        chromeTheme,
        base.controls.filterActiveIcon,
      ),
      checkboxBorder: resolveColor(
        controls?.checkboxBorder,
        chromeTheme,
        colorScheme === 'dark' ? '#c6d0cb' : base.controls.checkboxBorder,
      ),
      checkboxCheck: resolveColor(
        controls?.checkboxCheck,
        chromeTheme,
        chromeTheme.activeCellBorder,
      ),
      checkboxBackground: resolveColor(
        controls?.checkboxBackground,
        chromeTheme,
        colorScheme === 'dark' ? '#15191d' : base.controls.checkboxBackground,
      ),
      autofillHandle: resolveColor(
        controls?.autofillHandle,
        chromeTheme,
        chromeTheme.fillHandleColor,
      ),
      frozenPaneDivider: resolveColor(
        controls?.frozenPaneDivider,
        chromeTheme,
        colorScheme === 'dark' ? '#6b7770' : base.controls.frozenPaneDivider,
      ),
      hiddenIndicator: resolveColor(
        controls?.hiddenIndicator,
        chromeTheme,
        colorScheme === 'dark' ? '#89958f' : base.controls.hiddenIndicator,
      ),
    },
    overlays: {
      pastePreviewFill: resolveColor(
        overlays?.pastePreviewFill,
        chromeTheme,
        base.overlays.pastePreviewFill,
      ),
      pastePreviewBorder: resolveColor(
        overlays?.pastePreviewBorder,
        chromeTheme,
        chromeTheme.selectionBorder,
      ),
      searchHighlightFill: resolveColor(
        overlays?.searchHighlightFill,
        chromeTheme,
        base.overlays.searchHighlightFill,
      ),
      searchHighlightBorder: resolveColor(
        overlays?.searchHighlightBorder,
        chromeTheme,
        base.overlays.searchHighlightBorder,
      ),
      dragGhostFill: resolveColor(
        overlays?.dragGhostFill,
        chromeTheme,
        chromeTheme.dragSourceColor,
      ),
      dragGhostBorder: resolveColor(
        overlays?.dragGhostBorder,
        chromeTheme,
        chromeTheme.dragTargetColor,
      ),
      errorFill: resolveColor(overlays?.errorFill, chromeTheme, base.overlays.errorFill),
      errorBorder: resolveColor(overlays?.errorBorder, chromeTheme, base.overlays.errorBorder),
    },
  };

  return resolved;
}

export const DARK_SHEET_CHROME_THEME: ChromeTheme = {
  canvasBackground: '#15191d',
  gridlineColor: '#30383d',
  headerBackground: '#20262b',
  headerText: '#dce4df',
  headerBorder: '#3a4248',
  headerHighlightBackground: '#293b32',
  headerHighlightText: '#86efac',
  selectionFill: 'rgba(74, 222, 128, 0.14)',
  selectionBorder: '#4ade80',
  activeCellBorder: '#86efac',
  fillHandleColor: '#4ade80',
  dragSourceColor: 'rgba(74, 222, 128, 0.18)',
  dragTargetColor: '#86efac',
  scrollbarTrack: '#111417',
  scrollbarThumb: '#4a535a',
};

export function createResolvedSheetViewSkinForScheme(
  colorScheme: 'light' | 'dark',
  inputs: Omit<SkinResolutionInputs, 'colorScheme' | 'chromeTheme'> & {
    readonly chromeTheme?: SheetChromeTheme | ChromeTheme;
  } = { skin: null },
): ResolvedSheetViewSkin {
  return resolveSheetViewSkin({
    ...inputs,
    colorScheme,
    chromeTheme:
      inputs.chromeTheme ??
      (colorScheme === 'dark' ? DARK_SHEET_CHROME_THEME : DEFAULT_CHROME_THEME),
  });
}

// =============================================================================
// Implementation
// =============================================================================

export class SheetViewSkinCapability implements ISheetViewSkin {
  private _skin: SheetViewSkin | null = null;
  private _resolvedSkin: ResolvedSheetViewSkin = DEFAULT_RESOLVED_SHEET_VIEW_SKIN;
  private _status: SheetViewResolvedSkin['status'] = 'idle';
  private readonly _listeners: Set<(event: SheetViewSkinEvent) => void> = new Set();

  constructor(private readonly _internals: SkinInternals) {}

  set(skin: SheetViewSkin | null): void {
    this._skin = skin;
    this._status = skin ? 'ready' : 'idle';
    this._resolvedSkin = resolveSheetViewSkin({ skin });
    this._internals.updateResolvedSkin(this._resolvedSkin);
    this._emit({ type: 'change', skin });
    this._internals.invalidate();
  }

  get(): SheetViewSkin | null {
    return this._skin;
  }

  getResolved(): SheetViewResolvedSkin {
    return {
      skin: this._skin,
      status: this._status,
      validationErrors: [],
    };
  }

  getRendererSkin(): ResolvedSheetViewSkin {
    return this._resolvedSkin;
  }

  on(listener: (event: SheetViewSkinEvent) => void): SheetDisposable {
    this._listeners.add(listener);
    return {
      dispose: () => {
        this._listeners.delete(listener);
      },
    };
  }

  clear(): void {
    this._listeners.clear();
  }

  dispose(): void {
    this._skin = null;
    this._resolvedSkin = DEFAULT_RESOLVED_SHEET_VIEW_SKIN;
    this._status = 'idle';
    this.clear();
  }

  private _emit(event: SheetViewSkinEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        // Subscriber errors must not break SheetView lifecycle.
      }
    }
  }
}
