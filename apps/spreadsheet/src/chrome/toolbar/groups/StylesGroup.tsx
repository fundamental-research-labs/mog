/**
 * Styles Group
 *
 * Self-sufficient toolbar group for styling operations.
 * Excel layout: compact three-row command stack for Conditional Formatting,
 * Format as Table, and Cell Styles.
 *
 * Text formatting dispatch: Format as Table routes through INSERT_TABLE.
 * Cell Styles still delegates named styles to the existing toolbar action
 * helper until a typed APPLY_CELL_STYLE handler exists.
 *
 * Features:
 * - Conditional Formatting dropdown (Excel-like menu with quick rules, presets, and manager)
 * - Format as Table dropdown (creates table with selected style)
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

import type { TableStylePreset } from '@mog-sdk/contracts/tables';
import { STYLES_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { StyleGallery } from '../../../components/pickers/StyleGallery';
import { TableStyleGallery } from '../../../components/pickers/TableStyleGallery';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { useToolbarActions } from '../../../hooks/toolbar/use-toolbar-actions';
import {
  ConditionalFormattingMenu,
  ConditionalFormattingStackIcon,
} from '../galleries/ConditionalFormattingMenu';
import { keyTipRegistry } from '../keytips';
import { RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { StackedRibbonMenuButton } from '../primitives/StackedRibbonMenuButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';

// =============================================================================
// Icons
// =============================================================================

/**
 * Format as Table icon - table with header row.
 */
function FormatAsTableIcon() {
  return (
    <svg
      width="var(--ribbon-icon-size)"
      height="var(--ribbon-icon-size)"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Table icon with header */}
      <rect x="2" y="2" width="16" height="4" fill="#4472c4" rx="1" />
      <rect x="2" y="7" width="16" height="3" fill="#d6dce5" stroke="#8faadc" strokeWidth="0.3" />
      <rect x="2" y="11" width="16" height="3" fill="#ffffff" stroke="#8faadc" strokeWidth="0.3" />
      <rect x="2" y="15" width="16" height="3" fill="#d6dce5" stroke="#8faadc" strokeWidth="0.3" />
    </svg>
  );
}

function CellStylesIcon() {
  return (
    <svg
      width="var(--ribbon-icon-size)"
      height="var(--ribbon-icon-size)"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1.5" y="2" width="11" height="12" rx="1" fill="#ffffff" stroke="#6b7280" />
      <path d="M5.2 2v12M8.9 2v12M1.5 6h11M1.5 10h11" stroke="#9ca3af" strokeWidth="0.7" />
      <rect x="2.3" y="2.8" width="2.2" height="2.5" fill="#d8eadc" />
      <rect x="6" y="6.8" width="2.2" height="2.5" fill="#dbeafe" />
      <rect x="9.7" y="10.8" width="2" height="2.3" fill="#f8d7da" />
      <path
        d="M9.8 13.8 14 9.6l1.1 1.1-4.2 4.2-1.4.3.3-1.4z"
        fill="#2f7d59"
        stroke="#ffffff"
        strokeWidth="0.45"
      />
    </svg>
  );
}

// =============================================================================
// Component
// =============================================================================

/**
 * Styles toolbar group - self-sufficient, no props required.
 *
 * Compact three-row command stack:
 * - Conditional Formatting
 * - Format as Table
 * - Cell Styles
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

  // ===========================================================================
  // Render
  // ===========================================================================

  if (!isEnabled) return null;

  return (
    <ToolbarGroup
      label="Styles"
      collapseConfig={STYLES_COLLAPSE_CONFIG}
      dropdownIcon={<ConditionalFormattingStackIcon />}
    >
      <div className="flex flex-col justify-center gap-0.5">
        <ConditionalFormattingMenu variant="stacked" />

        <RibbonVisibilityItem item="formatAsTable">
          <div className="relative inline-flex">
            <StackedRibbonMenuButton
              id="format-as-table"
              testId="ribbon-dropdown-format-as-table"
              icon={<FormatAsTableIcon />}
              label="Format as Table"
              visibilityKey="formatAsTable"
              isOpen={tableStyleGalleryOpen}
              onClick={() => setTableStyleGalleryOpen(!tableStyleGalleryOpen)}
            />
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
        </RibbonVisibilityItem>

        <RibbonVisibilityItem item="cellStyles">
          <div className="relative inline-flex">
            <StackedRibbonMenuButton
              id="cell-styles"
              testId="ribbon-dropdown-cell-styles"
              icon={<CellStylesIcon />}
              label="Cell Styles"
              visibilityKey="cellStyles"
              isOpen={styleGalleryOpen}
              onClick={() => setStyleGalleryOpen(!styleGalleryOpen)}
            />
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
