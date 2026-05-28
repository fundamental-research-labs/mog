/**
 * ViewRibbon
 *
 * View tab content matching Excel 365 group order:
 * 1. Workbook Views - Normal, Page Break Preview, Page Layout, Custom Views
 * 2. Show - Ruler, Gridlines, Formula Bar, Headings
 * 3. Zoom - Zoom Out, dropdown, 100%, Zoom In, Zoom to Selection
 * 4. Window - New Window, Arrange All, Freeze Panes, Split, Hide, Unhide, Switch Windows
 * 5. Settings - CUSTOM (not in Excel, our addition for workbook/sheet settings)
 *
 * Ribbon Polish (V1, V2, V3, V4, V5)
 */

import { useCallback, useEffect } from 'react';
import { dispatch, useActiveSheetId, useUIStore } from '../../../internal-api';
import type { SpreadsheetDisplayMode } from '../../../ui-store/slices/core/display-mode';

import { Checkbox } from '@mog/shell';
import { ZOOM_PRESETS } from '@mog-sdk/contracts/rendering';
import {
  SETTINGS_COLLAPSE_CONFIG,
  SHOW_COLLAPSE_CONFIG,
  WINDOW_COLLAPSE_CONFIG,
  WORKBOOK_VIEWS_COLLAPSE_CONFIG,
  ZOOM_COLLAPSE_CONFIG,
} from '@mog-sdk/contracts/ribbon';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { useSplitConfig } from '../../../hooks/view/use-split-config';
import { formatZoomPercent } from '../../../infra/utils';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import {
  RibbonDropdownDivider,
  RibbonDropdownItem,
  RibbonDropdownPanel,
} from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';
import {
  FreezePanesIcon,
  GridlinesIcon,
  HeadingsIcon,
  PageLayoutViewIcon,
  SettingsIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../primitives/ToolbarIcons';
// =============================================================================
// Inline Icons for View Tab (stubs - not yet in ToolbarIcons.tsx)
// =============================================================================

/** Formula Bar icon (fx) */
function FormulaBarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="2" y="12" fontSize="11" fontStyle="italic" fontWeight="bold" fill="currentColor">
        fx
      </text>
    </svg>
  );
}

/** Checkmark icon for menu items */
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 8L6.5 11.5L13 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Split view icon */
function SplitViewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1.5" />
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Page Layout view icon */
function PageLayoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="2"
        y="1"
        width="12"
        height="14"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <line x1="4" y1="4" x2="12" y2="4" stroke="currentColor" strokeWidth="1" />
      <line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1" />
      <line x1="4" y1="10" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** Custom Views icon */
function CustomViewsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="1"
        y="3"
        width="6"
        height="5"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <rect
        x="9"
        y="3"
        width="6"
        height="5"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <rect
        x="1"
        y="9"
        width="6"
        height="5"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <rect
        x="9"
        y="9"
        width="6"
        height="5"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
    </svg>
  );
}

/** Ruler icon */
function RulerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="1"
        y="6"
        width="14"
        height="4"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <line x1="3" y1="6" x2="3" y2="8" stroke="currentColor" strokeWidth="1" />
      <line x1="5" y1="6" x2="5" y2="7" stroke="currentColor" strokeWidth="1" />
      <line x1="7" y1="6" x2="7" y2="8" stroke="currentColor" strokeWidth="1" />
      <line x1="9" y1="6" x2="9" y2="7" stroke="currentColor" strokeWidth="1" />
      <line x1="11" y1="6" x2="11" y2="8" stroke="currentColor" strokeWidth="1" />
      <line x1="13" y1="6" x2="13" y2="7" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** New Window icon */
function NewWindowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="1"
        y="3"
        width="10"
        height="10"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <rect
        x="5"
        y="1"
        width="10"
        height="10"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="white"
      />
      <line x1="10" y1="4" x2="10" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Arrange All icon */
function ArrangeAllIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="1"
        y="1"
        width="6"
        height="6"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <rect
        x="9"
        y="1"
        width="6"
        height="6"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <rect
        x="1"
        y="9"
        width="6"
        height="6"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <rect
        x="9"
        y="9"
        width="6"
        height="6"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
    </svg>
  );
}

/** Hide icon */
function HideIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="2"
        y="3"
        width="12"
        height="10"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <line x1="1" y1="15" x2="15" y2="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Unhide icon */
function UnhideIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="2"
        y="3"
        width="12"
        height="10"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M5 8L7 10L11 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Switch Windows icon */
function SwitchWindowsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="1"
        y="4"
        width="9"
        height="8"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <rect
        x="6"
        y="2"
        width="9"
        height="8"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="white"
      />
      <path
        d="M11 12L13 14L15 12"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// =============================================================================
// Types
// =============================================================================

interface ViewRibbonProps {
  /** Whether gridlines are shown */
  showGridlines?: boolean;
  /** Called when gridlines toggle is clicked */
  onToggleGridlines?: () => void;
  /** Whether headings are shown */
  showHeadings?: boolean;
  /** Called when headings toggle is clicked */
  onToggleHeadings?: () => void;
  // V1: Formula Bar visibility
  /** Whether the formula bar is shown */
  showFormulaBar?: boolean;
  /** Called when formula bar toggle is clicked */
  onToggleFormulaBar?: () => void;
  // Scrollbar visibility (Issue 7: View Options)
  /** Whether horizontal scrollbar is shown */
  showHorizontalScrollbar?: boolean;
  /** Called when horizontal scrollbar toggle is clicked */
  onToggleHorizontalScrollbar?: () => void;
  /** Whether vertical scrollbar is shown */
  showVerticalScrollbar?: boolean;
  /** Called when vertical scrollbar toggle is clicked */
  onToggleVerticalScrollbar?: () => void;
  /** Current zoom level (0.1 to 4.0, i.e., 10% to 400%) */
  currentZoom?: number;
  /** Called when zoom in button is clicked */
  onZoomIn?: () => void;
  /** Called when zoom out button is clicked */
  onZoomOut?: () => void;
  /** Called when zoom level is changed via dropdown */
  onZoomChange?: (zoom: number) => void;
  /** Called when "Zoom to Selection" is clicked */
  onZoomToSelection?: () => void;
  /** Whether there is a selection to zoom to */
  hasSelection?: boolean;
  /** Number of frozen rows (0 = none) */
  frozenRows?: number;
  /** Number of frozen columns (0 = none) */
  frozenCols?: number;
  /** Called when "Freeze Panes" is clicked (freeze at current selection) */
  onFreezePanes?: () => void;
  /** Called when "Freeze Top Row" is clicked */
  onFreezeTopRow?: () => void;
  /** Called when "Freeze First Column" is clicked */
  onFreezeFirstColumn?: () => void;
  /** Called when "Unfreeze Panes" is clicked */
  onUnfreeze?: () => void;
  // V3: Split view - DEPRECATED: Use dispatch('TOGGLE_SPLIT', deps) directly
  // These props are kept for backward compatibility but will be removed
  /** @deprecated Use dispatch('TOGGLE_SPLIT', deps) directly */
  onSplit?: () => void;
  /** @deprecated Use coordinator.getRendererExecution().getViewportConfig() */
  isSplit?: boolean;
  // Settings
  /** Called when "Spread Settings" button is clicked */
  onOpenSpreadSettings?: () => void;
  /** Called when "Sheet Settings" button is clicked */
  onOpenSheetSettings?: () => void;
  // Page Break Preview
  /** Whether page break preview mode is enabled */
  pageBreakPreviewMode?: boolean;
  /** Called when page break preview toggle is clicked */
  onTogglePageBreakPreview?: () => void;
}

function twoLineViewRibbonLabel(label: string): string {
  const breakAt = label.lastIndexOf(' ');
  return breakAt === -1 ? label : `${label.slice(0, breakAt)}\n${label.slice(breakAt + 1)}`;
}

export function ViewRibbon({
  showGridlines = true,
  onToggleGridlines,
  showHeadings = true,
  onToggleHeadings,
  // V1: Formula Bar visibility
  showFormulaBar = true,
  onToggleFormulaBar,
  // Scrollbar visibility (Issue 7: View Options)
  showHorizontalScrollbar = true,
  onToggleHorizontalScrollbar,
  showVerticalScrollbar = true,
  onToggleVerticalScrollbar,
  currentZoom = 1.0,
  onZoomIn,
  onZoomOut,
  onZoomChange,
  onZoomToSelection,
  hasSelection = false,
  frozenRows = 0,
  frozenCols = 0,
  onFreezePanes,
  onFreezeTopRow,
  onFreezeFirstColumn,
  onUnfreeze,
  // V3: Split view (props deprecated, using dispatch directly)
  onSplit: _onSplit,
  isSplit = false,
  onOpenSpreadSettings,
  onOpenSheetSettings,
  // Page Break Preview
  pageBreakPreviewMode = false,
  onTogglePageBreakPreview,
}: ViewRibbonProps) {
  const deps = useActionDependencies();
  const activeSheetId = useActiveSheetId();

  const isZoomEnabled = !!(onZoomIn && onZoomOut && onZoomChange);
  const isFreezeEnabled = !!(onFreezePanes && onFreezeTopRow && onFreezeFirstColumn && onUnfreeze);
  const isFrozen = frozenRows > 0 || frozenCols > 0;

  // freeze-panes dropdown lifted into the ribbonDropdowns slice so the
  // keytip chord (Alt+W,F) can open it via OPEN_RIBBON_DROPDOWN.
  const isDropdownOpen = useUIStore((s) => s.ribbonDropdowns['view.freeze-panes'] ?? false);
  const openRibbonDropdown = useUIStore((s) => s.openRibbonDropdown);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);
  const displayMode = useUIStore((s) => s.spreadsheetDisplayMode);
  const setDisplayMode = useUIStore((s) => s.setSpreadsheetDisplayMode);
  const setIsDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('view.freeze-panes') : closeRibbonDropdown('view.freeze-panes'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const isAppearanceOpen = useUIStore((s) => s.ribbonDropdowns['view.appearance-mode'] ?? false);
  const setAppearanceOpen = useCallback(
    (open: boolean) =>
      open
        ? openRibbonDropdown('view.appearance-mode')
        : closeRibbonDropdown('view.appearance-mode'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const handleAppearanceChoice = useCallback(
    (mode: SpreadsheetDisplayMode) => {
      setDisplayMode(mode);
      setAppearanceOpen(false);
    },
    [setDisplayMode, setAppearanceOpen],
  );

  // Split view handler - uses dispatch directly instead of prop threading
  // The split state is determined by checking if the sheet has a split config
  // Note: isSplit prop is deprecated but still supported for backward compatibility
  const handleSplitClick = useCallback(() => {
    dispatch('TOGGLE_SPLIT', deps);
  }, [deps]);

  const { isSplit: computedIsSplit } = useSplitConfig(activeSheetId);

  // Use computed split state, falling back to prop for backward compatibility
  const effectiveIsSplit = isSplit || computedIsSplit;

  const handleFreezeClick = useCallback(() => {
    if (isFreezeEnabled) {
      setIsDropdownOpen(!isDropdownOpen);
    }
  }, [isFreezeEnabled, isDropdownOpen, setIsDropdownOpen]);

  const handleMenuItemClick = useCallback(
    (action: () => void) => {
      action();
      setIsDropdownOpen(false);
    },
    [setIsDropdownOpen],
  );

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via typed `KeyboardShortcut` entries in
  // `keyboard/definitions/keytips-view.ts`.)
  // ===========================================================================

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    if (isFreezeEnabled) {
      keyTipRegistry.register({ key: 'F', tabId: 'view', elementId: 'view-freeze-panes' });
      cleanups.push(() => keyTipRegistry.unregister('F', 'view'));
    }

    keyTipRegistry.register({ key: 'S', tabId: 'view', elementId: 'view-split' });
    cleanups.push(() => keyTipRegistry.unregister('S', 'view'));

    if (onZoomIn) {
      keyTipRegistry.register({ key: 'I', tabId: 'view', elementId: 'view-zoom-in' });
      cleanups.push(() => keyTipRegistry.unregister('I', 'view'));
    }

    if (onZoomOut) {
      keyTipRegistry.register({ key: 'O', tabId: 'view', elementId: 'view-zoom-out' });
      cleanups.push(() => keyTipRegistry.unregister('O', 'view'));
    }

    if (onZoomChange) {
      keyTipRegistry.register({ key: 'Z', tabId: 'view', elementId: 'view-zoom-100' });
      cleanups.push(() => keyTipRegistry.unregister('Z', 'view'));
    }

    if (onOpenSpreadSettings) {
      keyTipRegistry.register({ key: 'W', tabId: 'view', elementId: 'view-workbook-settings' });
      cleanups.push(() => keyTipRegistry.unregister('W', 'view'));
    }

    if (onOpenSheetSettings) {
      keyTipRegistry.register({ key: 'T', tabId: 'view', elementId: 'view-sheet-settings' });
      cleanups.push(() => keyTipRegistry.unregister('T', 'view'));
    }
    keyTipRegistry.register({ key: 'A', tabId: 'view', elementId: 'view-appearance-mode-menu' });
    cleanups.push(() => keyTipRegistry.unregister('A', 'view'));

    return () => cleanups.forEach((c) => c());
  }, [
    isFreezeEnabled,
    onZoomIn,
    onZoomOut,
    onZoomChange,
    onOpenSpreadSettings,
    onOpenSheetSettings,
  ]);

  return (
    <>
      <ToolbarGroup
        label="Workbook Views"
        collapseConfig={WORKBOOK_VIEWS_COLLAPSE_CONFIG}
        dropdownIcon={<PageLayoutViewIcon />}
      >
        <div className="flex gap-1">
          {/* Normal View Button */}
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<span className="text-dropdown">📄</span>}
            label="Normal"
            isOpen={!pageBreakPreviewMode}
            onClick={pageBreakPreviewMode ? onTogglePageBreakPreview : undefined}
            title="Normal View"
            aria-label="Normal View"
            aria-pressed={!pageBreakPreviewMode}
          />
          {/* Page Break Preview Button */}
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<span className="text-dropdown">📊</span>}
            label={twoLineViewRibbonLabel('Page Break Preview')}
            isOpen={pageBreakPreviewMode}
            disabled={!onTogglePageBreakPreview}
            onClick={!pageBreakPreviewMode ? onTogglePageBreakPreview : undefined}
            title="Page Break Preview - See page breaks in the sheet"
            aria-label="Page Break Preview"
            aria-pressed={pageBreakPreviewMode}
          />
          {/* Page Layout View Button - Disabled stub */}
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<PageLayoutIcon />}
            label={twoLineViewRibbonLabel('Page Layout')}
            disabled
            title="Page Layout - View pages as they will print (coming soon)"
            aria-label="Page Layout"
          />
          {/* Custom Views Button - Disabled stub */}
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<CustomViewsIcon />}
            label={twoLineViewRibbonLabel('Custom Views')}
            disabled
            title="Custom Views - Save and manage custom views (coming soon)"
            aria-label="Custom Views"
          />
        </div>
      </ToolbarGroup>

      {/* 2. Show Group - 2-column, 3-row grid using constraint-based heights
       *
       * Height calculation: 3 rows must fit in 62px (--ribbon-content-height)
       * Using third-height (19.33px) per row with 2px gaps between rows.
       * Formula: 3 * 19.33 + 2 * 2 = 62px ✓
       *
       * Each cell: [icon] [checkbox] [label] - all on one line, no wrapping
       */}
      <ToolbarGroup
        label="Show"
        collapseConfig={SHOW_COLLAPSE_CONFIG}
        dropdownIcon={<GridlinesIcon />}
      >
        <div
          className="grid grid-cols-2 gap-x-2 px-0.5 overflow-hidden"
          style={{
            rowGap: 'var(--ribbon-button-gap)',
            height: 'var(--ribbon-content-height)',
          }}
        >
          {/* Row 1: Ruler | Headings */}
          <RibbonVisibilityItem item="ruler">
            <label
              className="flex items-center gap-1 whitespace-nowrap cursor-pointer opacity-50 min-w-0"
              style={{ height: 'var(--ribbon-button-height-third)' }}
              title="Ruler (coming soon)"
            >
              <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                <RulerIcon />
              </span>
              <Checkbox disabled />
              <span className="text-ribbon-compact text-ss-text-secondary">Ruler</span>
            </label>
          </RibbonVisibilityItem>
          <RibbonVisibilityItem item="headings">
            <label
              className={`flex items-center gap-1 whitespace-nowrap cursor-pointer min-w-0 ${!onToggleHeadings ? 'opacity-50' : ''}`}
              style={{ height: 'var(--ribbon-button-height-third)' }}
            >
              <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                <HeadingsIcon />
              </span>
              <Checkbox
                checked={showHeadings}
                onChange={() => onToggleHeadings?.()}
                disabled={!onToggleHeadings}
              />
              <span className="text-ribbon-compact text-ss-text-secondary">Headings</span>
            </label>
          </RibbonVisibilityItem>

          {/* Row 2: Gridlines | Formula Bar */}
          <RibbonVisibilityItem item="gridlines">
            <label
              className={`flex items-center gap-1 whitespace-nowrap cursor-pointer min-w-0 ${!onToggleGridlines ? 'opacity-50' : ''}`}
              style={{ height: 'var(--ribbon-button-height-third)' }}
            >
              <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                <GridlinesIcon />
              </span>
              <Checkbox
                checked={showGridlines}
                onChange={() => onToggleGridlines?.()}
                disabled={!onToggleGridlines}
              />
              <span className="text-ribbon-compact text-ss-text-secondary">Gridlines</span>
            </label>
          </RibbonVisibilityItem>
          {/* Chrome-symmetry: Formula Bar reopen lives here. The label
 carries the contract testid + data-action; the Checkbox
 inherits the label click target so a single click toggles
 visibility regardless of which child was clicked. */}
          <RibbonVisibilityItem item="formulaBar">
            <label
              data-testid="panel-formula-bar-reopen"
              data-action="open-panel-formula-bar"
              className={`flex items-center gap-1 whitespace-nowrap cursor-pointer min-w-0 ${!onToggleFormulaBar ? 'opacity-50' : ''}`}
              style={{ height: 'var(--ribbon-button-height-third)' }}
            >
              <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                <FormulaBarIcon />
              </span>
              <Checkbox
                checked={showFormulaBar}
                onChange={() => onToggleFormulaBar?.()}
                disabled={!onToggleFormulaBar}
              />
              <span className="text-ribbon-compact text-ss-text-secondary">Formula</span>
            </label>
          </RibbonVisibilityItem>

          {/* Row 3: H. Scrollbar | V. Scrollbar */}
          <RibbonVisibilityItem item="horizontalScrollbar">
            <label
              className={`flex items-center gap-1 whitespace-nowrap cursor-pointer min-w-0 ${!onToggleHorizontalScrollbar ? 'opacity-50' : ''}`}
              style={{ height: 'var(--ribbon-button-height-third)' }}
            >
              <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-ribbon-compact">
                ↔
              </span>
              <Checkbox
                checked={showHorizontalScrollbar}
                onChange={() => onToggleHorizontalScrollbar?.()}
                disabled={!onToggleHorizontalScrollbar}
              />
              <span className="text-ribbon-compact text-ss-text-secondary">H-Scroll</span>
            </label>
          </RibbonVisibilityItem>
          <RibbonVisibilityItem item="verticalScrollbar">
            <label
              className={`flex items-center gap-1 whitespace-nowrap cursor-pointer min-w-0 ${!onToggleVerticalScrollbar ? 'opacity-50' : ''}`}
              style={{ height: 'var(--ribbon-button-height-third)' }}
            >
              <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-ribbon-compact">
                ↕
              </span>
              <Checkbox
                checked={showVerticalScrollbar}
                onChange={() => onToggleVerticalScrollbar?.()}
                disabled={!onToggleVerticalScrollbar}
              />
              <span className="text-ribbon-compact text-ss-text-secondary">V-Scroll</span>
            </label>
          </RibbonVisibilityItem>
        </div>
      </ToolbarGroup>

      {/* 3. Zoom Group - V2: Added 100% button */}
      <ToolbarGroup
        label="Zoom"
        collapseConfig={ZOOM_COLLAPSE_CONFIG}
        dropdownIcon={<ZoomInIcon />}
      >
        <div className="flex items-center gap-1">
          {/* Zoom Out Button */}
          <RibbonButton
            id="view-zoom-out"
            layout="icon-only"
            icon={<ZoomOutIcon />}
            disabled={!isZoomEnabled}
            onClick={onZoomOut}
            title="Zoom Out (Ctrl+-)"
            aria-label="Zoom Out"
          />

          {/* Zoom Dropdown */}
          <RibbonVisibilityItem item="zoom">
            <select
              value={currentZoom}
              onChange={(e) => onZoomChange?.(parseFloat(e.target.value))}
              disabled={!isZoomEnabled}
              className={`
 h-7 px-1 rounded border border-ss-border
 bg-ss-surface text-dropdown text-ss-text-secondary text-center
 outline-none w-[70px]
 ${isZoomEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}
 `}
              title="Zoom Level"
              aria-label="Zoom Level"
            >
              {ZOOM_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {formatZoomPercent(preset)}
                </option>
              ))}
              {/* Show current zoom if it's not a preset */}
              {!ZOOM_PRESETS.includes(currentZoom as (typeof ZOOM_PRESETS)[number]) && (
                <option value={currentZoom}>{formatZoomPercent(currentZoom)}</option>
              )}
            </select>
          </RibbonVisibilityItem>

          {/* V2: 100% Quick Zoom Button */}
          <RibbonButton
            id="view-zoom-100"
            layout="text"
            label="100%"
            disabled={!isZoomEnabled}
            onClick={() => onZoomChange?.(1.0)}
            isOpen={currentZoom === 1.0}
            title="Reset to 100%"
            visibilityKey="oneHundredPercent"
          />

          {/* Zoom In Button */}
          <RibbonButton
            id="view-zoom-in"
            layout="icon-only"
            icon={<ZoomInIcon />}
            disabled={!isZoomEnabled}
            onClick={onZoomIn}
            title="Zoom In (Ctrl++)"
            aria-label="Zoom In"
          />

          {/* Zoom to Selection Button */}
          <RibbonButton
            layout="icon-only"
            icon={<span className="text-ribbon">🔍</span>}
            disabled={!onZoomToSelection || !hasSelection}
            onClick={onZoomToSelection}
            title="Zoom to Selection - Fit selection in view"
            aria-label="Zoom to Selection"
            visibilityKey="zoomToSelection"
          />
        </div>
      </ToolbarGroup>

      {/* 4. Window Group - V3: Added Split button, V5: Added Excel parity buttons */}
      <ToolbarGroup
        label="Window"
        collapseConfig={WINDOW_COLLAPSE_CONFIG}
        dropdownIcon={<FreezePanesIcon />}
      >
        <div className="flex items-center gap-1">
          {/* New Window Button - Disabled stub */}
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<NewWindowIcon />}
            label={twoLineViewRibbonLabel('New Window')}
            disabled
            title="New Window - Open another window for this workbook (coming soon)"
            aria-label="New Window"
          />

          {/* Arrange All Button - Disabled stub */}
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<ArrangeAllIcon />}
            label={twoLineViewRibbonLabel('Arrange All')}
            disabled
            title="Arrange All - Tile all open workbook windows (coming soon)"
            aria-label="Arrange All"
          />

          {/* Freeze Panes Button with Dropdown */}
          <div className="relative inline-flex">
            <RibbonButton
              id="view-freeze-panes"
              layout="vertical"
              height="full"
              data-testid="ribbon-dropdown-freeze-panes"
              icon={<FreezePanesIcon />}
              label={twoLineViewRibbonLabel('Freeze Panes')}
              hasDropdown
              dropdownPosition="inline"
              isOpen={isFrozen || isDropdownOpen}
              disabled={!isFreezeEnabled}
              onClick={handleFreezeClick}
              title={
                isFrozen ? `Frozen: ${frozenRows} rows, ${frozenCols} columns` : 'Freeze Panes'
              }
              aria-label="Freeze Panes"
              aria-expanded={isDropdownOpen}
              aria-haspopup="menu"
            />

            {/* Portal-based dropdown - escapes stacking context issues */}
            <RibbonDropdownPanel
              open={isDropdownOpen && isFreezeEnabled}
              onClose={() => setIsDropdownOpen(false)}
            >
              <div
                data-testid="ribbon-dropdown-menu-freeze-panes"
                className="bg-ss-surface rounded shadow-ss-md border border-ss-border min-w-[180px] py-1"
                role="menu"
                aria-label="Freeze Panes Options"
              >
                {/* Freeze Panes (at selection) */}
                <RibbonDropdownItem
                  dataValue="freeze-panes"
                  icon={
                    isFrozen && frozenRows > 1 && frozenCols > 0 ? (
                      <CheckIcon />
                    ) : (
                      <span className="w-4" />
                    )
                  }
                  onClick={() => handleMenuItemClick(onFreezePanes!)}
                >
                  Freeze Panes
                </RibbonDropdownItem>

                {/* Freeze Top Row */}
                <RibbonDropdownItem
                  dataValue="freeze-top-row"
                  icon={
                    frozenRows === 1 && frozenCols === 0 ? <CheckIcon /> : <span className="w-4" />
                  }
                  onClick={() => handleMenuItemClick(onFreezeTopRow!)}
                >
                  Freeze Top Row
                </RibbonDropdownItem>

                {/* Freeze First Column */}
                <RibbonDropdownItem
                  dataValue="freeze-first-column"
                  icon={
                    frozenRows === 0 && frozenCols === 1 ? <CheckIcon /> : <span className="w-4" />
                  }
                  onClick={() => handleMenuItemClick(onFreezeFirstColumn!)}
                >
                  Freeze First Column
                </RibbonDropdownItem>

                <RibbonDropdownDivider />

                {/* Unfreeze Panes */}
                <RibbonDropdownItem
                  dataValue="unfreeze"
                  icon={<span className="w-4" />}
                  onClick={() => handleMenuItemClick(onUnfreeze!)}
                  disabled={!isFrozen}
                >
                  Unfreeze Panes
                </RibbonDropdownItem>
              </div>
            </RibbonDropdownPanel>
          </div>

          {/* V3: Split Button - Uses dispatch('TOGGLE_SPLIT') directly */}
          <RibbonButton
            id="view-split"
            layout="vertical"
            height="full"
            icon={<SplitViewIcon />}
            label={twoLineViewRibbonLabel(effectiveIsSplit ? 'Remove Split' : 'Split')}
            isOpen={effectiveIsSplit}
            disabled={false}
            onClick={handleSplitClick}
            title={effectiveIsSplit ? 'Remove Split' : 'Split - Divide the window into panes'}
            aria-label="Split"
            aria-pressed={effectiveIsSplit}
            visibilityKey="split"
          />

          {/* Hide Button - Disabled stub */}
          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<HideIcon />}
            label="Hide"
            disabled
            title="Hide - Hide the current workbook window (coming soon)"
            aria-label="Hide"
          />

          {/* Unhide Button - Disabled stub */}
          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<UnhideIcon />}
            label="Unhide"
            disabled
            title="Unhide - Show hidden workbook windows (coming soon)"
            aria-label="Unhide"
          />

          {/* Switch Windows Button with Dropdown - Disabled stub */}
          <RibbonButton
            layout="vertical"
            height="full"
            data-testid="ribbon-dropdown-switch-windows"
            icon={<SwitchWindowsIcon />}
            label={twoLineViewRibbonLabel('Switch Windows')}
            hasDropdown
            disabled
            title="Switch Windows - Switch to another open window (coming soon)"
            aria-label="Switch Windows"
          />
        </div>
      </ToolbarGroup>

      {/*
 5. Settings Group - CUSTOM (V4)
 This group is NOT in Excel 365 - it's our custom addition for easy access
 to workbook and sheet settings dialogs. Documented as intentional deviation.
 */}
      <ToolbarGroup
        label="Settings"
        collapseConfig={SETTINGS_COLLAPSE_CONFIG}
        dropdownIcon={<SettingsIcon />}
      >
        <div className="flex gap-1">
          <div className="relative inline-flex">
            <RibbonButton
              id="view-appearance-mode-menu"
              layout="vertical"
              height="full"
              data-testid="view-appearance-mode-menu"
              icon={<span className="text-dropdown">◐</span>}
              label="Appearance"
              hasDropdown
              dropdownPosition="inline"
              isOpen={isAppearanceOpen}
              onClick={() => setAppearanceOpen(!isAppearanceOpen)}
              title="Appearance mode"
              visibilityKey="appearance"
              aria-label="Appearance mode"
              aria-expanded={isAppearanceOpen}
              aria-haspopup="menu"
            />
            <RibbonDropdownPanel open={isAppearanceOpen} onClose={() => setAppearanceOpen(false)}>
              <div
                data-testid="view-appearance-mode-menu-items"
                className="bg-ss-surface rounded shadow-ss-md border border-ss-border min-w-[150px] py-1"
                role="menu"
                aria-label="Appearance mode"
              >
                {(['light', 'dark', 'system'] as const).map((mode) => (
                  <RibbonDropdownItem
                    key={mode}
                    testId={`view-appearance-mode-${mode}`}
                    dataValue={mode}
                    icon={displayMode === mode ? <CheckIcon /> : <span className="w-4" />}
                    onClick={() => handleAppearanceChoice(mode)}
                  >
                    {mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System'}
                  </RibbonDropdownItem>
                ))}
              </div>
            </RibbonDropdownPanel>
          </div>
          <RibbonButton
            id="view-workbook-settings"
            layout="vertical"
            height="full"
            icon={<SettingsIcon />}
            label="Workbook"
            disabled={!onOpenSpreadSettings}
            onClick={onOpenSpreadSettings}
            title="Workbook Settings"
            aria-label="Workbook Settings"
          />
          <RibbonButton
            id="view-sheet-settings"
            layout="vertical"
            height="full"
            icon={<SettingsIcon />}
            label="Sheet"
            disabled={!onOpenSheetSettings}
            onClick={onOpenSheetSettings}
            title="Sheet Settings"
            aria-label="Sheet Settings"
          />
        </div>
      </ToolbarGroup>

      {/* Chrome-symmetry: panel reopen affordances (issue #116).
 All five closable panels are reachable from a single, predictable
 home. Each button carries `data-testid="panel-<id>-reopen"` and
 `data-action="open-panel-<id>"` so the chrome-symmetry harness can
 follow either selector. Clicking the button re-mounts the panel. */}
      <ViewRibbonPanelReopenGroup />
    </>
  );
}

/**
 * Panel reopen group — chrome-symmetry contract anchor for issue #116.
 *
 * All five closable chrome panels (formula-bar, status-bar, side,
 * comments, find) ship reopen affordances here. This is the single
 * documented home for "I closed a panel — how do I get it back?".
 * Do not scatter reopen affordances across other ribbons.
 */
function ViewRibbonPanelReopenGroup() {
  const deps = useActionDependencies();
  const setFormulaBarVisible = useUIStore((s) => s.setFormulaBarVisible);
  const setStatusBarVisible = useUIStore((s) => s.setStatusBarVisible);
  const setCommentsPanelVisible = useUIStore((s) => s.setCommentsPanelVisible);
  const setSidePanelVisible = useUIStore((s) => s.setSidePanelVisible);

  const handleOpenFormulaBar = useCallback(() => {
    setFormulaBarVisible(true);
  }, [setFormulaBarVisible]);

  const handleOpenStatusBar = useCallback(() => {
    setStatusBarVisible(true);
  }, [setStatusBarVisible]);

  const handleOpenSidePanel = useCallback(() => {
    setSidePanelVisible(true);
  }, [setSidePanelVisible]);

  const handleOpenCommentsPanel = useCallback(() => {
    setCommentsPanelVisible(true);
  }, [setCommentsPanelVisible]);

  const handleOpenFind = useCallback(() => {
    // Find lives in the find-replace XState machine; the Ctrl+F keyboard
    // path is preserved (this just adds a click affordance).
    dispatch('OPEN_FIND_DIALOG', deps);
  }, [deps]);

  return (
    <ToolbarGroup
      label="Panels"
      isLast
      collapseConfig={SETTINGS_COLLAPSE_CONFIG}
      dropdownIcon={<SettingsIcon />}
    >
      <div className="flex gap-1">
        <RibbonButton
          layout="vertical"
          height="full"
          width="narrow"
          icon={<FormulaBarIcon />}
          label={twoLineViewRibbonLabel('Formula bar')}
          onClick={handleOpenFormulaBar}
          data-testid="panel-formula-bar-reopen"
          data-action="open-panel-formula-bar"
          title="Show formula bar"
          aria-label="Show formula bar"
          visibilityKey="formulaBar"
        />
        <RibbonButton
          layout="vertical"
          height="full"
          width="narrow"
          icon={<span className="text-dropdown">▭</span>}
          label={twoLineViewRibbonLabel('Status bar')}
          onClick={handleOpenStatusBar}
          data-testid="panel-status-bar-reopen"
          data-action="open-panel-status-bar"
          title="Show status bar"
          aria-label="Show status bar"
          visibilityKey="statusBar"
        />
        <RibbonButton
          layout="vertical"
          height="full"
          width="narrow"
          icon={<span className="text-dropdown">📋</span>}
          label="Side"
          onClick={handleOpenSidePanel}
          data-testid="panel-side-reopen"
          data-action="open-panel-side"
          title="Show side panel"
          aria-label="Show side panel"
          visibilityKey="side"
        />
        <RibbonButton
          layout="vertical"
          height="full"
          width="narrow"
          icon={<span className="text-dropdown">💬</span>}
          label="Comments"
          onClick={handleOpenCommentsPanel}
          data-testid="panel-comments-reopen"
          data-action="open-panel-comments"
          title="Show comments"
          aria-label="Show comments"
          visibilityKey="comments"
        />
        <RibbonButton
          layout="vertical"
          height="full"
          width="narrow"
          icon={<span className="text-dropdown">🔍</span>}
          label="Find"
          onClick={handleOpenFind}
          data-testid="panel-find-reopen"
          data-action="open-panel-find"
          visibilityKey="find"
          title="Find (Ctrl+F)"
          aria-label="Find"
        />
      </div>
    </ToolbarGroup>
  );
}
