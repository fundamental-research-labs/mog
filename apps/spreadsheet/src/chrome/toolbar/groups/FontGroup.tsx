/**
 * FontGroup Component
 *
 * Self-sufficient Font formatting group for the Home ribbon.
 * Reads granular activeCellFormat selectors from UIStore and routes every
 * onClick through the unified `useDispatch()` action system. This is the
 * dispatch-compliance reference for text-formatting groups; see ArrangeGroup.tsx
 * for the corresponding object-side reference.
 *
 * Features:
 * - Font family picker
 * - Font size selector
 * - Bold, Italic, Underline, Strikethrough toggles
 * - Font color picker
 * - Background color picker
 * - Border picker
 * - Clear formatting
 *
 * COLLAPSE SUPPORT:
 * FontGroup reads GroupRenderModeContext to adapt its layout
 * - 'icons' mode: Font picker and size selector become compact/icon-only
 * - 'compact' mode: Reduced widths for pickers
 * - 'full' mode: Full width pickers with labels
 * Passes FONT_COLLAPSE_CONFIG to ToolbarGroup
 * - Priority 2 - essential formatting
 *
 * KEYTIPS:
 * - FF = Font Family
 * - FS = Font Size
 * - 1 = Bold
 * - 2 = Italic
 * - 3 = Underline
 * - 4 = Strikethrough
 * - FC = Font Color
 * - H = Fill Color (Highlight)
 * - B = Borders
 * (Clear Format uses Ctrl+\ shortcut; E keytip reserved for Editing Group's Clear)
 *
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import {
  useActiveCell,
  useActiveSheetId,
  useDocumentContext,
  useFeatureGate,
  useUIStore,
  useWorkbook,
} from '../../../internal-api';

import { Tooltip } from '@mog/shell';
import type { BorderPresetMode, BorderStyle, CellBorders } from '@mog-sdk/contracts/core';
import { FONT_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { BorderPicker } from '../../../components/pickers/BorderPicker';
import { ColorPicker } from '../../../components/pickers/ColorPicker';
import { FontPicker, type FontPickerResult } from '../../../components/pickers/FontPicker';
import { FontSizePicker } from '../../../components/pickers/FontSizePicker';
import { useCoordinator } from '../../../hooks/shared/use-coordinator';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { useSheetProtectionPermissions } from '../../../hooks/structure/use-sheet-protection';
import { OFFICE_THEME } from '../../../infra/styles/built-in-themes';
import { getRecentColors } from '../../../infra/styles/recent-colors';
import type { BorderSelection, BorderStyleType } from '../../../internal-api';
import { readCommonFormatProperty } from '../../../dialogs/formatting/format-cells/mixed-state';
import { useGroupRenderMode } from '../collapse';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { SplitButton } from '../primitives/SplitButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  BoldIcon,
  BorderIcon,
  ClearFormatIcon,
  DropdownArrowIcon,
  FillColorIcon,
  FontColorIcon,
  FontIcon,
  FontSizeDecreaseIcon,
  FontSizeIncreaseIcon,
  ItalicIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from '../primitives/ToolbarIcons';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';
// Note: DropdownArrowIcon is still used for the font picker dropdown
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '../primitives/ToolbarStyles';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert BorderSelection (UI shape) → CellBorders (contracts shape) for the
 * APPLY_BORDERS action payload. Inlined here from the deleted
 * use-font-actions hook. Moving the conversion into the APPLY_BORDERS handler
 * is a separate cleanup.
 */
function convertBorderSide(
  side: { width: number; style: BorderStyleType; color: string } | null | undefined,
): BorderStyle | undefined {
  if (side === null) {
    // null means remove border
    return { style: 'none' };
  }
  if (side === undefined) {
    // undefined means don't change
    return undefined;
  }
  // BorderStyleType maps directly to BorderStyle.style — the style already
  // contains the full border style (thin, medium, thick, dashed, etc.).
  return { style: side.style, color: side.color };
}

// =============================================================================
// SplitButton main-click defaults (Excel-parity first-use behavior)
// =============================================================================

/**
 * Black — preserves today's main-click fallback. Whether Excel's first-use
 * should stamp red is a separate Excel-parity question.
 */
const DEFAULT_FONT_COLOR = '#000000';

/**
 * Yellow highlight — matches today's hard-coded fallback and Excel's
 * highlighter default.
 */
const DEFAULT_FILL_COLOR = '#FFFF00';

/**
 * Bottom border (thin, black) — matches Excel's first-use default for
 * the Borders SplitButton (the bottom-edge glyph the icon visually
 * represents). Preset is `null` so the handler applies it per-cell
 * (position-independent), which is what Excel does for first-use on
 * any selection size.
 */
const DEFAULT_BORDER: { borders: CellBorders; preset: BorderPresetMode } = {
  borders: { bottom: { style: 'thin', color: '#000000' } },
  preset: null,
};

const FONT_SIZE_STEP_ICON_STYLE = {
  '--ribbon-icon-size': '15px',
} as React.CSSProperties;

// =============================================================================
// Component
// =============================================================================

/**
 * FontGroup - Self-sufficient font formatting group.
 *
 * No props required - all state comes from UIStore via granular Zustand
 * selectors and all writes go through `useDispatch()`.
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 */
export const FontGroup = React.memo(function FontGroup() {
  const isEnabled = useFeatureGate('groups', 'font');

  // ===========================================================================
  // Dispatch (unified action system - hook form per ArrangeGroup convention)
  // ===========================================================================

  const dispatch = useDispatch();
  const coordinator = useCoordinator();
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const { activeCell } = useActiveCell();
  const canFormatCells = useSheetProtectionPermissions(activeSheetId).formatCells;

  // ===========================================================================
  // Derived state — granular Zustand selectors. Each selector subscribes
  // independently so changes to one property don't re-render components only
  // using other properties. Copied verbatim from the deleted
  // use-font-actions hook so re-render behavior is unchanged.
  // ===========================================================================

  const isBold = useUIStore((s) => s.activeCellFormat?.bold ?? false);
  const isItalic = useUIStore((s) => s.activeCellFormat?.italic ?? false);
  const isUnderline = useUIStore((s) => {
    const type = s.activeCellFormat?.underlineType;
    return type !== undefined && type !== 'none';
  });
  const isStrikethrough = useUIStore((s) => s.activeCellFormat?.strikethrough ?? false);
  const fontFamily = useUIStore((s) => s.activeCellFormat?.fontFamily ?? DEFAULT_FONT_FAMILY);
  const fontSize = useUIStore((s) => s.activeCellFormat?.fontSize ?? DEFAULT_FONT_SIZE);
  // Invalidation only: the picker value itself must come from worksheet formats
  // so off-viewport and mixed selections are read correctly.
  const activeCellFormatForInvalidation = useUIStore((s) => s.activeCellFormat);
  const backgroundColor = useUIStore((s) => s.activeCellFormat?.backgroundColor);
  const toolbarRanges = useUIStore((s) => s.toolbarRanges);
  const [fontColor, setFontColor] = useState<string | undefined>(undefined);

  // ===========================================================================
  // Collapse Support
  // ===========================================================================

  const groupMode = useGroupRenderMode();
  const isIconsMode = groupMode === 'icons';
  const isCompactMode = groupMode === 'compact';

  // ===========================================================================
  // Picker dropdown state
  //
  // Open-state lives in the uiStore so the keyboard chord shortcuts
  // (`Alt+H,KeyB`, `Alt+H,KeyH`, `Alt+H,KeyF,KeyC`, `Alt+H,KeyF,KeyF`)
  // can fire `OPEN_<X>_PICKER` actions and have the popover open.
  // Each setter both (a) dispatches the action so it routes through
  // the unified action system and (b) clears the slice on close so
  // Radix's `onOpenChange(false)` from click-outside / ESC stays in
  // sync with slice state.
  // ===========================================================================

  const { uiStore } = useDocumentContext();
  const fontPickerOpen = useStore(uiStore, (s) => s.fontFamilyPicker.open);
  const fontColorOpen = useStore(uiStore, (s) => s.fontColorPicker.open);
  const bgColorOpen = useStore(uiStore, (s) => s.fillColorPicker.open);
  const borderPickerOpen = useStore(uiStore, (s) => s.bordersPicker.open);
  const closeFontFamilyPicker = useStore(uiStore, (s) => s.closeFontFamilyPicker);
  const closeFontColorPicker = useStore(uiStore, (s) => s.closeFontColorPicker);
  const closeFillColorPicker = useStore(uiStore, (s) => s.closeFillColorPicker);
  const closeBordersPicker = useStore(uiStore, (s) => s.closeBordersPicker);

  // Last-used selections from each picker — main-click on the SplitButton
  // replays these. Recording happens in the action handlers
  // (`SET_FONT_COLOR`, `SET_BACKGROUND_COLOR`, `APPLY_BORDERS`), not here,
  // so any path that reaches those actions records identically.
  const lastUsedFontColor = useStore(uiStore, (s) => s.lastUsedFontColor);
  const lastUsedFillColor = useStore(uiStore, (s) => s.lastUsedFillColor);
  const lastUsedBorderFormat = useStore(uiStore, (s) => s.lastUsedBorderFormat);

  useEffect(() => {
    let cancelled = false;
    setFontColor(undefined);

    const readSelectionFontColor = async () => {
      try {
        const ws = wb.getSheetById(activeSheetId);
        const result = await readCommonFormatProperty({
          formats: ws.formats,
          activeCell,
          ranges: toolbarRanges,
          property: 'fontColor',
          defaultValue: DEFAULT_FONT_COLOR,
        });
        if (!cancelled) {
          setFontColor(result.value);
        }
      } catch {
        if (!cancelled) {
          setFontColor(undefined);
        }
      }
    };

    void readSelectionFontColor();
    return () => {
      cancelled = true;
    };
  }, [
    wb,
    activeSheetId,
    activeCell.row,
    activeCell.col,
    toolbarRanges,
    activeCellFormatForInvalidation,
  ]);

  const setFontPickerOpen = useCallback(
    (open: boolean) => {
      if (open) {
        dispatch('OPEN_FONT_FAMILY_PICKER');
      } else {
        closeFontFamilyPicker();
      }
    },
    [dispatch, closeFontFamilyPicker],
  );
  const setFontColorOpen = useCallback(
    (open: boolean) => {
      if (open) {
        dispatch('OPEN_FONT_COLOR_PICKER');
      } else {
        closeFontColorPicker();
      }
    },
    [dispatch, closeFontColorPicker],
  );
  const setBgColorOpen = useCallback(
    (open: boolean) => {
      if (open) {
        dispatch('OPEN_FILL_COLOR_PICKER');
      } else {
        closeFillColorPicker();
      }
    },
    [dispatch, closeFillColorPicker],
  );
  const setBorderPickerOpen = useCallback(
    (open: boolean) => {
      if (open) {
        dispatch('OPEN_BORDERS_PICKER');
      } else {
        closeBordersPicker();
      }
    },
    [dispatch, closeBordersPicker],
  );

  // Recent colors state - force re-render when colors change
  const [recentFontColors, setRecentFontColors] = useState(() => getRecentColors('font'));
  const [recentFillColors, setRecentFillColors] = useState(() => getRecentColors('fill'));
  const [recentBorderColors, setRecentBorderColors] = useState(() => getRecentColors('border'));

  // Handler to apply font color and track in recents.
  const handleFontColorChange = useCallback(
    (color: string | null) => {
      dispatch('SET_FONT_COLOR', { color: color ?? undefined });
      if (color) {
        dispatch('TRACK_RECENT_COLOR', { type: 'font', color });
        setRecentFontColors(getRecentColors('font'));
      }
    },
    [dispatch],
  );

  // Handler to apply fill color and track in recents.
  const handleFillColorChange = useCallback(
    (color: string | null) => {
      dispatch('SET_BACKGROUND_COLOR', { color: color ?? undefined });
      if (color) {
        dispatch('TRACK_RECENT_COLOR', { type: 'fill', color });
        setRecentFillColors(getRecentColors('fill'));
      }
    },
    [dispatch],
  );

  // Handler to track border color selection and refresh state.
  const handleBorderColorSelect = useCallback(
    (color: string) => {
      dispatch('TRACK_RECENT_COLOR', { type: 'border', color });
      setRecentBorderColors(getRecentColors('border'));
    },
    [dispatch],
  );

  // Apply borders via APPLY_BORDERS. Threading `preset` through is what
  // makes "Outside Borders" on a multi-cell selection apply to the
  // perimeter — without it, the handler falls back to per-cell apply
  // and paints all 4 sides on every cell. Conversion stays at the call
  // site; moving convertBorderSide into the handler is a separate cleanup.
  const applyBorders = useCallback(
    (borders: BorderSelection, preset: BorderPresetMode) => {
      const cellBorders: CellBorders = {};
      const topBorder = convertBorderSide(borders.top);
      const rightBorder = convertBorderSide(borders.right);
      const bottomBorder = convertBorderSide(borders.bottom);
      const leftBorder = convertBorderSide(borders.left);

      if (topBorder !== undefined) cellBorders.top = topBorder;
      if (rightBorder !== undefined) cellBorders.right = rightBorder;
      if (bottomBorder !== undefined) cellBorders.bottom = bottomBorder;
      if (leftBorder !== undefined) cellBorders.left = leftBorder;

      dispatch('APPLY_BORDERS', { borders: cellBorders, preset });
    },
    [dispatch],
  );

  // ===========================================================================
  // SplitButton main-click replay (Excel parity)
  //
  // Main click on each formatting SplitButton re-applies the user's last
  // selection from the dropdown. First-use (no prior selection) falls
  // back to the fixed default that matches the icon glyph. Last-used is
  // recorded by the action handlers themselves (`SET_FONT_COLOR`,
  // `SET_BACKGROUND_COLOR`, `APPLY_BORDERS`), so the replay path here is
  // idempotent — dispatching with the recorded value re-records the
  // same value.
  // ===========================================================================

  const applyLastFontColor = useCallback(
    () => dispatch('SET_FONT_COLOR', { color: lastUsedFontColor ?? DEFAULT_FONT_COLOR }),
    [dispatch, lastUsedFontColor],
  );
  const applyLastFillColor = useCallback(
    () => dispatch('SET_BACKGROUND_COLOR', { color: lastUsedFillColor ?? DEFAULT_FILL_COLOR }),
    [dispatch, lastUsedFillColor],
  );
  const applyLastBorder = useCallback(() => {
    const { borders, preset } = lastUsedBorderFormat ?? DEFAULT_BORDER;
    dispatch('APPLY_BORDERS', { borders, preset });
  }, [dispatch, lastUsedBorderFormat]);

  // ===========================================================================
  // KeyTip registration
  // Excel Home tab Font keytips
  // ===========================================================================

  useEffect(() => {
    // unified keytip router: keytip badges register *only* the
    // display data. Each keytip's action lives as a typed
    // `KeyboardShortcut` entry in
    // `apps/spreadsheet/src/keyboard/definitions/keytips-home.ts` and
    // fires through the unified action dispatcher. No action closures
    // here — the registry's `action` field is deprecated (will
    // delete it).
    keyTipRegistry.register({
      key: 'FF',
      tabId: 'home',
      elementId: 'font-family-picker',
    });
    keyTipRegistry.register({
      key: 'FS',
      tabId: 'home',
      elementId: 'font-size-picker',
    });
    keyTipRegistry.register({
      key: '1',
      tabId: 'home',
      elementId: 'font-bold',
    });
    keyTipRegistry.register({
      key: '2',
      tabId: 'home',
      elementId: 'font-italic',
    });
    keyTipRegistry.register({
      key: '3',
      tabId: 'home',
      elementId: 'font-underline',
    });
    keyTipRegistry.register({
      key: '4',
      tabId: 'home',
      elementId: 'font-strikethrough',
    });
    keyTipRegistry.register({
      key: 'FC',
      tabId: 'home',
      elementId: 'font-color',
    });
    keyTipRegistry.register({
      key: 'H',
      tabId: 'home',
      elementId: 'fill-color',
    });
    keyTipRegistry.register({
      key: 'B',
      tabId: 'home',
      elementId: 'borders',
    });

    // Note: 'E' keytip for Clear Format removed to avoid conflict with
    // EditingGroup's Clear dropdown which matches Excel behavior.
    // Clear Formatting can still be accessed via Ctrl+\ keyboard shortcut.

    // Cleanup on unmount
    return () => {
      keyTipRegistry.unregister('FF', 'home');
      keyTipRegistry.unregister('FS', 'home');
      keyTipRegistry.unregister('1', 'home');
      keyTipRegistry.unregister('2', 'home');
      keyTipRegistry.unregister('3', 'home');
      keyTipRegistry.unregister('4', 'home');
      keyTipRegistry.unregister('FC', 'home');
      keyTipRegistry.unregister('H', 'home');
      keyTipRegistry.unregister('B', 'home');
    };
    // PERFORMANCE FIX: Empty dependency array - keytips are static registration
    // that should happen once on mount. Including callbacks caused 100+ unnecessary
    // re-registrations during cell edits when activeCellFormat changed.
    // @see docs/ARCHITECTURE-CHECKLIST.md Section 15: Render Isolation
  }, []);

  // ===========================================================================
  // Render
  // ===========================================================================

  if (!isEnabled) return null;

  return (
    <ToolbarGroup label="Font" collapseConfig={FONT_COLLAPSE_CONFIG} dropdownIcon={<FontIcon />}>
      <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
        {/* Row 1: Font family & size */}
        <div className="flex items-center gap-1">
          {/* Font Family Picker */}
          <RibbonVisibilityItem item="fontFamily">
            <div id="font-family-picker" className="relative inline-flex">
              {isIconsMode ? (
                // Icons mode: Show icon-only button
                <Tooltip title={`Font: ${fontFamily ?? DEFAULT_FONT_FAMILY}`}>
                  <RibbonButton
                    layout="icon-only"
                    // This branch only renders when isIconsMode is true, so the
                    // testid is unconditionally correct here. The full-picker
                    // branch below has no testid to avoid harness ambiguity
                    // during responsive remounts.
                    data-testid="ribbon-dropdown-font-family"
                    icon={<FontIcon />}
                    onClick={() => setFontPickerOpen(!fontPickerOpen)}
                    isOpen={fontPickerOpen}
                    aria-label="Font family"
                    aria-expanded={fontPickerOpen}
                    aria-haspopup="listbox"
                  />
                </Tooltip>
              ) : (
                // Full/Compact mode: Show full picker
                <button
                  type="button"
                  data-testid="ribbon-dropdown-font-family"
                  onClick={() => setFontPickerOpen(!fontPickerOpen)}
                  disabled={!canFormatCells}
                  className={`
 h-7 px-2 ${isCompactMode ? 'min-w-[80px] max-w-[100px]' : 'min-w-[100px] max-w-[130px]'}
 flex items-center justify-between
 border rounded
 bg-ss-surface text-ss-text-secondary text-ribbon
 cursor-pointer outline-none disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed disabled:pointer-events-none
 transition-colors duration-ss-fast
 hover:bg-ss-surface-hover
 ${fontPickerOpen ? 'border-ss-primary ring-1 ring-ss-primary' : 'border-ss-border'}
 `}
                  style={{ fontFamily: `"${fontFamily ?? DEFAULT_FONT_FAMILY}", sans-serif` }}
                  title="Font family"
                  aria-label="Font family"
                  aria-expanded={fontPickerOpen}
                  aria-haspopup="listbox"
                >
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                    {fontFamily ?? DEFAULT_FONT_FAMILY}
                  </span>
                  <DropdownArrowIcon className="ml-1" />
                </button>
              )}
              <RibbonDropdownPanel open={fontPickerOpen} onClose={() => setFontPickerOpen(false)}>
                <div data-testid="ribbon-dropdown-menu-font-family">
                  <FontPicker
                    value={fontFamily ?? DEFAULT_FONT_FAMILY}
                    theme={OFFICE_THEME} // TODO: Get from workbook settings when theme switching is implemented
                    onChange={(family) => {
                      dispatch('SET_FONT_FAMILY', { family });
                      setFontPickerOpen(false);
                    }}
                    onSelect={(result: FontPickerResult) => {
                      // New callback - handles both theme fonts and concrete fonts
                      if (result.type === 'theme') {
                        dispatch('SET_FONT_THEME', { fontTheme: result.fontTheme });
                      } else {
                        dispatch('SET_FONT_FAMILY', { family: result.fontFamily });
                      }
                      setFontPickerOpen(false);
                    }}
                    onClose={() => setFontPickerOpen(false)}
                  />
                </div>
              </RibbonDropdownPanel>
            </div>
          </RibbonVisibilityItem>

          {/* Font Size Picker - dispatch SET_FONT_SIZE */}
          <RibbonVisibilityItem item="fontSize">
            {!isIconsMode && (
              <div id="font-size-picker">
                <div className={!canFormatCells ? 'pointer-events-none opacity-50 grayscale' : ''}>
                  <FontSizePicker
                    value={fontSize ?? DEFAULT_FONT_SIZE}
                    onChange={(size) => dispatch('SET_FONT_SIZE', { size })}
                    onDismiss={() => coordinator.input.focusGrid()}
                    isCompact={isCompactMode}
                  />
                </div>
              </div>
            )}
          </RibbonVisibilityItem>

          {/* Increase Font Size */}
          <Tooltip title="Increase Font Size">
            <RibbonButton
              layout="icon-only"
              icon={
                <span className="translate-y-px" style={FONT_SIZE_STEP_ICON_STYLE}>
                  <FontSizeIncreaseIcon />
                </span>
              }
              onClick={() => dispatch('INCREASE_FONT_SIZE')}
              disabled={!canFormatCells}
              id="increase-font-size"
              aria-label="Increase font size"
            />
          </Tooltip>

          {/* Decrease Font Size */}
          <Tooltip title="Decrease Font Size">
            <RibbonButton
              layout="icon-only"
              icon={
                <span className="translate-y-px" style={FONT_SIZE_STEP_ICON_STYLE}>
                  <FontSizeDecreaseIcon />
                </span>
              }
              onClick={() => dispatch('DECREASE_FONT_SIZE')}
              disabled={!canFormatCells}
              id="decrease-font-size"
              aria-label="Decrease font size"
            />
          </Tooltip>
        </div>

        {/* Row 2: Font formatting */}
        <div className="flex items-center gap-[var(--ribbon-button-inline-gap)]">
          <Tooltip title="Bold" shortcut="Ctrl+B">
            <RibbonButton
              id="font-bold"
              layout="icon-only"
              icon={<BoldIcon />}
              onClick={() => dispatch('TOGGLE_BOLD')}
              isOpen={isBold}
              disabled={!canFormatCells}
              aria-label="Bold"
              aria-pressed={isBold}
            />
          </Tooltip>
          <Tooltip title="Italic" shortcut="Ctrl+I">
            <RibbonButton
              id="font-italic"
              layout="icon-only"
              icon={<ItalicIcon />}
              onClick={() => dispatch('TOGGLE_ITALIC')}
              isOpen={isItalic}
              disabled={!canFormatCells}
              aria-label="Italic"
              aria-pressed={isItalic}
            />
          </Tooltip>
          <Tooltip title="Underline" shortcut="Ctrl+U">
            <RibbonButton
              id="font-underline"
              layout="icon-only"
              icon={<UnderlineIcon />}
              onClick={() => dispatch('TOGGLE_UNDERLINE')}
              isOpen={isUnderline}
              disabled={!canFormatCells}
              aria-label="Underline"
              aria-pressed={isUnderline}
            />
          </Tooltip>
          <Tooltip title="Strikethrough" shortcut="Ctrl+5">
            <RibbonButton
              id="font-strikethrough"
              layout="icon-only"
              icon={<StrikethroughIcon />}
              onClick={() => dispatch('TOGGLE_STRIKETHROUGH')}
              isOpen={isStrikethrough}
              disabled={!canFormatCells}
              aria-label="Strikethrough"
              aria-pressed={isStrikethrough}
            />
          </Tooltip>

          <div className="w-px h-6 bg-ss-surface-tertiary mx-1" />

          {/* Font Color - Split button: main applies last color, dropdown opens picker */}
          <div className="relative inline-flex">
            <Tooltip title="Font Color">
              <SplitButton
                id="font-color"
                icon={<FontColorIcon color={fontColor} />}
                variant="small"
                isOpen={fontColorOpen}
                onMainClick={applyLastFontColor}
                onDropdownClick={() => setFontColorOpen(!fontColorOpen)}
                disabled={!canFormatCells}
                title="Font Color"
                aria-label="Font color"
                visibilityKey="fontColor"
                dropdownTestId="font-color-dropdown-trigger"
              />
            </Tooltip>
            <RibbonDropdownPanel open={fontColorOpen} onClose={() => setFontColorOpen(false)}>
              <div data-testid="ribbon-dropdown-menu-font-color">
                <ColorPicker
                  value={fontColor}
                  onChange={(color) => {
                    handleFontColorChange(color);
                    setFontColorOpen(false);
                  }}
                  onClose={() => setFontColorOpen(false)}
                  showNoColor={true}
                  noColorLabel="Automatic"
                  recentColors={recentFontColors}
                />
              </div>
            </RibbonDropdownPanel>
          </div>

          {/* Background Color - Split button: main applies last color, dropdown opens picker */}
          <div className="relative inline-flex">
            <Tooltip title="Fill Color">
              <SplitButton
                id="fill-color"
                icon={<FillColorIcon color={backgroundColor} />}
                variant="small"
                isOpen={bgColorOpen}
                onMainClick={applyLastFillColor}
                onDropdownClick={() => setBgColorOpen(!bgColorOpen)}
                disabled={!canFormatCells}
                title="Fill Color"
                aria-label="Fill color"
                visibilityKey="fillColor"
                dropdownTestId="fill-color-dropdown-trigger"
              />
            </Tooltip>
            <RibbonDropdownPanel open={bgColorOpen} onClose={() => setBgColorOpen(false)}>
              <div data-testid="ribbon-dropdown-menu-fill-color">
                <ColorPicker
                  value={backgroundColor}
                  onChange={(color) => {
                    handleFillColorChange(color);
                    setBgColorOpen(false);
                  }}
                  onClose={() => setBgColorOpen(false)}
                  showNoColor={true}
                  noColorLabel="No Fill"
                  recentColors={recentFillColors}
                />
              </div>
            </RibbonDropdownPanel>
          </div>

          {/* Border - Split button: main applies last border, dropdown opens picker */}
          <div className="relative inline-flex">
            <Tooltip title="Borders">
              <SplitButton
                id="borders"
                icon={<BorderIcon />}
                variant="small"
                isOpen={borderPickerOpen}
                onMainClick={applyLastBorder}
                onDropdownClick={() => setBorderPickerOpen(!borderPickerOpen)}
                disabled={!canFormatCells}
                title="Borders"
                aria-label="Borders"
                visibilityKey="borders"
                dropdownTestId="ribbon-dropdown-border"
              />
            </Tooltip>
            <RibbonDropdownPanel open={borderPickerOpen} onClose={() => setBorderPickerOpen(false)}>
              <div data-testid="ribbon-dropdown-menu-border">
                <BorderPicker
                  onChange={(borders, preset) => {
                    applyBorders(borders, preset);
                    setBorderPickerOpen(false);
                  }}
                  onClose={() => setBorderPickerOpen(false)}
                  onColorSelect={handleBorderColorSelect}
                  recentColors={recentBorderColors}
                />
              </div>
            </RibbonDropdownPanel>
          </div>

          {/* Clear Formatting */}
          <Tooltip title="Clear Formatting" shortcut="Ctrl+\">
            <RibbonButton
              id="clear-format"
              layout="icon-only"
              icon={<ClearFormatIcon />}
              onClick={() => dispatch('CLEAR_FORMATS')}
              disabled={!canFormatCells}
              aria-label="Clear Formatting"
            />
          </Tooltip>
        </div>
      </div>
    </ToolbarGroup>
  );
});
