/**
 * Styles Group
 *
 * Self-sufficient toolbar group for styling operations.
 * Excel layout: Conditional Formatting, Format as Table, then a 2x2 grid of
 * quick-pick style chips (Normal, Good, Bad, Neutral) with Cell Styles dropdown.
 *
 * Text formatting dispatch: clearFormat (the "Normal" quick-pick chip)
 * routes through `useDispatch()`/`dispatch('CLEAR_FORMATS')`. The
 * applyStyle / formatAsTable code paths still call non-dispatch helpers
 * (`useToolbarActions().handleApplyStyle` and `ws.tables.add` directly) —
 * those need APPLY_CELL_STYLE / FORMAT_AS_TABLE handlers which are out of
 * scope for text formatting. It does not add new ActionTypes here.
 *
 * Features:
 * - Conditional Formatting dropdown (Excel-like menu with quick rules, presets, and manager)
 * - Format as Table dropdown (creates table with selected style)
 * - Quick-pick style chips for one-click style application
 * - Cell Styles dropdown (applies built-in cell styles)
 *
 * COLLAPSE SUPPORT (
 * - Passes STYLES_COLLAPSE_CONFIG to ToolbarGroup
 * - Priority 4 - can be accessed via dropdown (lower priority)
 *
 * KEYTIPS:
 * - J = Conditional Formatting
 * - L = Format as Table
 * - S = Cell Styles
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 *
 */

import React, { useCallback, useEffect } from 'react';
import { useFeatureGate, useUIStore } from '../../../internal-api';

import { Tooltip } from '@mog/shell';
import type { TableStylePreset } from '@mog-sdk/contracts/tables';
import { STYLES_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { StyleGallery } from '../../../components/pickers/StyleGallery';
import { TableStyleGallery } from '../../../components/pickers/TableStyleGallery';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { useToolbarActions } from '../../../hooks/toolbar/use-toolbar-actions';
import { ConditionalFormattingMenu } from '../galleries/ConditionalFormattingMenu';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { ConditionalFormatIcon, DropdownArrowIcon } from '../primitives/ToolbarIcons';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';

// =============================================================================
// Icons
// =============================================================================

/**
 * Format as Table icon - table with header row.
 */
function FormatAsTableIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      {/* Table icon with header */}
      <rect x="2" y="2" width="16" height="4" fill="#4472c4" rx="1" />
      <rect x="2" y="7" width="16" height="3" fill="#d6dce5" stroke="#8faadc" strokeWidth="0.3" />
      <rect x="2" y="11" width="16" height="3" fill="#ffffff" stroke="#8faadc" strokeWidth="0.3" />
      <rect x="2" y="15" width="16" height="3" fill="#d6dce5" stroke="#8faadc" strokeWidth="0.3" />
    </svg>
  );
}

// =============================================================================
// Quick-Pick Style Chips
// =============================================================================

/**
 * Quick-pick style definitions.
 * These match Excel's 2x2 grid of Normal, Good, Bad, Neutral.
 * "Normal" clears formatting (represented as null styleId).
 */
const QUICK_PICK_STYLES = [
  { id: null, name: 'Normal', bgColor: '#ffffff', textColor: '#000000', borderColor: '#d4d4d4' },
  { id: 'bad', name: 'Bad', bgColor: '#ffc7ce', textColor: '#9c0006', borderColor: '#9c0006' },
  { id: 'good', name: 'Good', bgColor: '#c6efce', textColor: '#006100', borderColor: '#006100' },
  {
    id: 'neutral',
    name: 'Neutral',
    bgColor: '#ffeb9c',
    textColor: '#9c5700',
    borderColor: '#9c5700',
  },
] as const;

interface StylePreviewChipProps {
  /** Style ID or null for "Normal" (clear formatting) */
  styleId: string | null;
  /** Display name */
  name: string;
  /** Background color */
  bgColor: string;
  /** Text/border color for the chip */
  textColor: string;
  /** Border color */
  borderColor: string;
  /** Click handler */
  onClick: () => void;
}

/**
 * Small colored preview chip for quick style application.
 * Shows a preview of the style with the style name.
 */
function StylePreviewChip({
  name,
  bgColor,
  textColor,
  borderColor,
  onClick,
}: StylePreviewChipProps) {
  return (
    <Tooltip title={name} description={`Apply ${name} style`}>
      <button
        type="button"
        onClick={onClick}
        className="
 flex items-center justify-center
 min-w-[36px] h-[20px] px-1.5
 text-ribbon-chip leading-none font-medium
 whitespace-nowrap
 rounded-ss-sm cursor-pointer
 border transition-all duration-ss-fast
 hover:ring-1 hover:ring-ss-primary hover:ring-offset-1
 focus:outline-none focus-visible:ring-2 focus-visible:ring-ss-primary
 "
        style={{
          backgroundColor: bgColor,
          color: textColor,
          borderColor: borderColor,
        }}
        aria-label={`Apply ${name} style`}
      >
        {name}
      </button>
    </Tooltip>
  );
}

// =============================================================================
// Component
// =============================================================================

/**
 * Styles toolbar group - self-sufficient, no props required.
 *
 * Layout matches Excel:
 * - Conditional Formatting (large button with dropdown)
 * - Format as Table (large button with gallery dropdown)
 * - Quick-pick style chips (2x2 grid: Normal, Bad, Good, Neutral) with Cell Styles dropdown
 *
 * Memoized to prevent re-renders when parent re-renders.
 */
export const StylesGroup = React.memo(function StylesGroup() {
  const isEnabled = useFeatureGate('groups', 'styles');

  // ===========================================================================
  // Dispatch (unified action system - hook form per ArrangeGroup convention)
  // ===========================================================================

  const dispatch = useDispatch();

  // applyStyle currently has no dispatch equivalent — handleApplyStyle from
  // useToolbarActions writes through the Worksheet API directly. Migrating
  // this to a typed APPLY_CELL_STYLE handler is out of scope for text formatting scope
  // (which targets the deletable `use-*-actions.ts` ribbon hooks); flagged
  // for a follow-up cleanup.
  const { handleApplyStyle } = useToolbarActions();

  const formatAsTable = useCallback(
    (styleId: TableStylePreset) => {
      void dispatch('INSERT_TABLE', { stylePreset: styleId });
    },
    [dispatch],
  );

  // applyStyle: dispatch CLEAR_FORMATS for "normal", else delegate to
  // handleApplyStyle (the latter is the out-of-scope path noted above).
  const applyStyle = useCallback(
    (styleId: string) => {
      if (styleId === 'normal') {
        dispatch('CLEAR_FORMATS');
      } else {
        handleApplyStyle(styleId);
      }
    },
    [dispatch, handleApplyStyle],
  );

  // ===========================================================================
  // Local State (UI state for dropdowns)
  //
  // lifted into the ribbonDropdowns slice so the keytip chords
  // (Alt+H,T for format-as-table, Alt+H,S for cell-styles) can open
  // these via OPEN_RIBBON_DROPDOWN.
  // ===========================================================================

  const tableStyleGalleryOpen = useUIStore(
    (s) => s.ribbonDropdowns['home.format-as-table'] ?? false,
  );
  const styleGalleryOpen = useUIStore((s) => s.ribbonDropdowns['home.cell-styles'] ?? false);
  const openRibbonDropdown = useUIStore((s) => s.openRibbonDropdown);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);
  const setTableStyleGalleryOpen = useCallback(
    (open: boolean) =>
      open
        ? openRibbonDropdown('home.format-as-table')
        : closeRibbonDropdown('home.format-as-table'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setStyleGalleryOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('home.cell-styles') : closeRibbonDropdown('home.cell-styles'),
    [openRibbonDropdown, closeRibbonDropdown],
  );

  // ===========================================================================
  // KeyTip Registration (display-only)
  // ===========================================================================

  useEffect(() => {
    keyTipRegistry.register({ key: 'L', tabId: 'home', elementId: 'format-as-table' });
    keyTipRegistry.register({ key: 'S', tabId: 'home', elementId: 'cell-styles' });

    return () => {
      keyTipRegistry.unregister('L', 'home');
      keyTipRegistry.unregister('S', 'home');
    };
  }, []);

  // ===========================================================================
  // Handlers
  // ===========================================================================

  /**
   * Handle quick-pick style chip click.
   * null id means "Normal" (CLEAR_FORMATS), otherwise apply the named style.
   */
  const handleQuickStyleClick = (styleId: string | null) => {
    if (styleId === null) {
      dispatch('CLEAR_FORMATS');
    } else {
      applyStyle(styleId);
    }
  };

  // ===========================================================================
  // Render
  // ===========================================================================

  if (!isEnabled) return null;

  return (
    <ToolbarGroup
      label="Styles"
      collapseConfig={STYLES_COLLAPSE_CONFIG}
      dropdownIcon={<ConditionalFormatIcon />}
      onDialogLaunch={() => dispatch('OPEN_FORMAT_CELLS_DIALOG')}
      dialogLaunchTitle="Cell Styles Settings"
    >
      <div className="flex items-start gap-1">
        {/* Conditional Formatting - Dropdown Menu (Excel-like) */}
        <ConditionalFormattingMenu />

        {/* Format as Table - Large Button with Gallery */}
        <div className="relative inline-flex">
          <Tooltip title="Format as Table" description="Convert data to a table with formatting">
            <RibbonButton
              layout="vertical"
              height="full"
              data-testid="ribbon-dropdown-format-as-table"
              icon={<FormatAsTableIcon />}
              label="Table"
              hasDropdown
              dropdownPosition="inline"
              isOpen={tableStyleGalleryOpen}
              onClick={() => setTableStyleGalleryOpen(!tableStyleGalleryOpen)}
              aria-label="Format as Table"
            />
          </Tooltip>
          <RibbonDropdownPanel
            open={tableStyleGalleryOpen}
            onClose={() => setTableStyleGalleryOpen(false)}
            position="bottom-right"
          >
            <div data-testid="ribbon-dropdown-menu-format-as-table">
              <TableStyleGallery
                onSelectStyle={(styleId) => {
                  formatAsTable(styleId);
                  setTableStyleGalleryOpen(false);
                }}
                onClose={() => setTableStyleGalleryOpen(false)}
              />
            </div>
          </RibbonDropdownPanel>
        </div>

        {/* Quick-Pick Style Chips + Cell Styles Dropdown */}
        <RibbonVisibilityItem item="cellStyles">
          <div className="relative inline-flex flex-col items-start h-[var(--ribbon-content-height)] justify-between py-1">
            {/* 2x2 Grid of style preview chips */}
            <div className="flex flex-wrap content-start gap-0.5 w-[92px]">
              {QUICK_PICK_STYLES.map((style) => (
                <StylePreviewChip
                  key={style.name}
                  styleId={style.id}
                  name={style.name}
                  bgColor={style.bgColor}
                  textColor={style.textColor}
                  borderColor={style.borderColor}
                  onClick={() => handleQuickStyleClick(style.id)}
                />
              ))}
            </div>

            {/* Cell Styles dropdown button */}
            <Tooltip title="Cell Styles" description="Apply predefined cell styles">
              <button
                type="button"
                data-testid="ribbon-dropdown-cell-styles"
                onClick={() => setStyleGalleryOpen(!styleGalleryOpen)}
                className="
 flex items-center gap-0.5 px-1 py-0.5
 text-ribbon text-ss-text-secondary
 rounded cursor-pointer
 hover:bg-ss-surface-hover
 transition-all duration-ss-fast
 "
                aria-label="Cell Styles"
                aria-expanded={styleGalleryOpen}
                aria-haspopup="menu"
              >
                <span>Cell Styles</span>
                <DropdownArrowIcon className={styleGalleryOpen ? 'rotate-180' : ''} />
              </button>
            </Tooltip>

            {/* Cell Styles Gallery Dropdown */}
            <RibbonDropdownPanel
              open={styleGalleryOpen}
              onClose={() => setStyleGalleryOpen(false)}
              position="bottom-right"
            >
              <div data-testid="ribbon-dropdown-menu-cell-styles">
                <StyleGallery
                  onSelectStyle={(styleId) => {
                    applyStyle(styleId);
                    setStyleGalleryOpen(false);
                  }}
                  onClose={() => setStyleGalleryOpen(false)}
                />
              </div>
            </RibbonDropdownPanel>
          </div>
        </RibbonVisibilityItem>
      </div>
    </ToolbarGroup>
  );
});
