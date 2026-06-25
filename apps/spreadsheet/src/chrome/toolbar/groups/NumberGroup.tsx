/**
 * NumberGroup
 *
 * Self-sufficient toolbar group for number formatting. Reads granular
 * activeCellFormat and recent-formats selectors directly from UIStore and
 * routes every onClick through `useDispatch` (Text formatting dispatch).
 *
 * Features:
 * - Number format dropdown with preview
 * - Quick format buttons (Currency, Percent, Comma)
 * - Decimal place adjustment
 *
 * COLLAPSE SUPPORT:
 * NumberGroup reads GroupRenderModeContext to adapt its layout
 * - 'icons' mode: Number format dropdown becomes icon-only button
 * - 'compact' mode: Reduced width for dropdown
 * - 'full' mode: Full width dropdown with format name
 * Passes NUMBER_COLLAPSE_CONFIG to ToolbarGroup
 * - Priority 3 - important but not critical
 *
 * KEYTIPS:
 * - NF = Number Format dropdown
 * - $ = Currency format (dollar sign)
 * - P = Percent format
 * - K = Comma format (thousand separator)
 * - 0 = Increase decimals
 * - 9 = Decrease decimals
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 *
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import {
  useActiveSheetId,
  useDocumentContext,
  useFeatureGate,
  useUIStore,
  useWorkbook,
} from '../../../internal-api';

import { Tooltip } from '@mog/shell';
import { NUMBER_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { buildFormatCode, CURRENCY_SYMBOLS } from '@mog/spreadsheet-utils/number-formats';
import { NumberFormatPanel } from '../../../dialogs/formatting/NumberFormatPanel';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { useSheetProtectionPermissions } from '../../../hooks/structure/use-sheet-protection';
import { useGroupRenderMode } from '../collapse';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownItem, RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { SplitButton } from '../primitives/SplitButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  CommaStyleIcon,
  CurrencyIcon,
  DecimalDecreaseIcon,
  DecimalIncreaseIcon,
  DropdownArrowIcon,
  NumberFormatIcon,
  PercentIcon,
} from '../primitives/ToolbarIcons';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get human-readable display name for a number format code.
 * Maps Excel-style format codes to their category names. Inlined here from
 * the deleted use-number-format-actions hook.
 */
function getFormatDisplayName(formatCode: string): string {
  const formatMap: Record<string, string> = {
    General: 'General',
    '@': 'Text',
    '0': 'Number',
    '0.00': 'Number',
    '#,##0': 'Number',
    '#,##0.00': 'Number',
    '$#,##0': 'Currency',
    '$#,##0.00': 'Currency',
    '0%': 'Percent',
    '0.00%': 'Percent',
    '0.00E+00': 'Scientific',
  };

  if (formatMap[formatCode]) {
    return formatMap[formatCode];
  }

  if (
    formatCode.includes('$') ||
    formatCode.includes('€') ||
    formatCode.includes('£') ||
    formatCode.includes('¥')
  ) {
    return 'Currency';
  }
  if (formatCode.includes('%')) {
    return 'Percent';
  }
  if (formatCode.includes('E+') || formatCode.includes('E-')) {
    return 'Scientific';
  }
  if (formatCode.includes('/')) {
    return 'Fraction';
  }
  if (
    formatCode.includes('yy') ||
    formatCode.includes('mm') ||
    formatCode.includes('dd') ||
    formatCode.includes('h:') ||
    formatCode.includes(':ss')
  ) {
    return 'Date';
  }
  return 'Custom';
}

const TOOLBAR_CURRENCY_CODES = ['USD', 'GBP', 'EUR', 'JPY'] as const;

const TOOLBAR_CURRENCY_OPTIONS = TOOLBAR_CURRENCY_CODES.map((code) => {
  const currency = CURRENCY_SYMBOLS.find((candidate) => candidate.code === code);
  const symbol = currency?.symbol ?? code;
  return {
    code,
    symbol,
    format: buildFormatCode({
      type: 'currency',
      decimalPlaces: 2,
      currencySymbol: symbol,
    }),
  };
});

// =============================================================================
// Component
// =============================================================================

/**
 * Number format group component.
 *
 * No props required — granular Zustand selectors + useDispatch.
 * Memoized to prevent re-renders when parent re-renders.
 */
export const NumberGroup = React.memo(function NumberGroup() {
  const isEnabled = useFeatureGate('groups', 'number');

  // ===========================================================================
  // Dispatch (unified action system - hook form per ArrangeGroup convention)
  // ===========================================================================

  const dispatch = useDispatch();

  // ===========================================================================
  // Derived state — granular Zustand selectors
  // ===========================================================================

  const numberFormat = useUIStore((s) => s.activeCellFormat?.numberFormat ?? 'General');
  const formatDisplayName = getFormatDisplayName(numberFormat);
  const recentNumberFormats = useUIStore((s) => s.recentNumberFormats);

  // sampleValue: read from viewport for the format-preview panel.
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const canFormatCells = useSheetProtectionPermissions(activeSheetId).formatCells;
  const ws = wb.getSheetById(activeSheetId);
  const sampleValue = useMemo((): number | string | undefined => {
    const activeCellData = ws.viewport.getActiveCellData();
    if (!activeCellData) return undefined;
    const cv = activeCellData.value;
    if (typeof cv === 'number') return cv;
    if (typeof cv === 'string') return cv;
    return undefined;
  }, [ws]);

  // ===========================================================================
  // Collapse Support
  // ===========================================================================

  const groupMode = useGroupRenderMode();
  const isIconsMode = groupMode === 'icons';
  const isCompactMode = groupMode === 'compact';

  // ===========================================================================
  // Picker dropdown state
  //
  // Number-format dropdown lives in the uiStore so the keyboard chord
  // shortcut (`Alt+H,KeyN,KeyF`) can fire `OPEN_NUMBER_FORMAT_DROPDOWN`
  // and have the popover open. Currency-flavor sub-dropdown stays
  // local — it's not driven by a chord shortcut.
  // ===========================================================================

  const { uiStore } = useDocumentContext();
  const numberFormatOpen = useStore(uiStore, (s) => s.numberFormatDropdown.open);
  const closeNumberFormatDropdown = useStore(uiStore, (s) => s.closeNumberFormatDropdown);
  const setNumberFormatOpen = useCallback(
    (open: boolean) => {
      if (open) {
        if (!canFormatCells) return;
        dispatch('OPEN_NUMBER_FORMAT_DROPDOWN');
      } else {
        closeNumberFormatDropdown();
      }
    },
    [canFormatCells, dispatch, closeNumberFormatDropdown],
  );

  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);

  useEffect(() => {
    if (!canFormatCells) {
      if (numberFormatOpen) closeNumberFormatDropdown();
      if (currencyDropdownOpen) setCurrencyDropdownOpen(false);
    }
  }, [canFormatCells, closeNumberFormatDropdown, currencyDropdownOpen, numberFormatOpen]);

  // ===========================================================================
  // KeyTip registration
  // ===========================================================================

  useEffect(() => {
    keyTipRegistry.register({
      key: 'N',
      tabId: 'home',
      elementId: 'number-format',
    });
    keyTipRegistry.register({
      key: '$',
      tabId: 'home',
      elementId: 'currency-format',
    });
    keyTipRegistry.register({
      key: 'P',
      tabId: 'home',
      elementId: 'percent-format',
    });
    keyTipRegistry.register({
      key: 'K',
      tabId: 'home',
      elementId: 'comma-format',
    });
    keyTipRegistry.register({
      key: '0',
      tabId: 'home',
      elementId: 'increase-decimals',
    });
    keyTipRegistry.register({
      key: '9',
      tabId: 'home',
      elementId: 'decrease-decimals',
    });

    return () => {
      keyTipRegistry.unregister('N', 'home');
      keyTipRegistry.unregister('$', 'home');
      keyTipRegistry.unregister('P', 'home');
      keyTipRegistry.unregister('K', 'home');
      keyTipRegistry.unregister('0', 'home');
      keyTipRegistry.unregister('9', 'home');
    };
  }, []);

  // ===========================================================================
  // Render
  // ===========================================================================

  if (!isEnabled) return null;

  return (
    <ToolbarGroup
      label="Number"
      collapseConfig={NUMBER_COLLAPSE_CONFIG}
      dropdownIcon={<NumberFormatIcon />}
    >
      <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
        {/* Row 1: Number format dropdown */}
        <RibbonVisibilityItem item="numberFormat">
          <div id="number-format" className="relative inline-flex">
            {isIconsMode ? (
              // Icons mode: Show icon-only button
              <Tooltip title={`Format: ${formatDisplayName}`}>
                <RibbonButton
                  layout="icon-only"
                  // This branch only renders when isIconsMode is true, so the
                  // testid is unconditionally correct here. The full-picker
                  // branch below has no testid to avoid harness ambiguity
                  // during responsive remounts.
                  data-testid="ribbon-dropdown-number-format"
                  icon={<NumberFormatIcon />}
                  onClick={() => setNumberFormatOpen(!numberFormatOpen)}
                  isOpen={numberFormatOpen}
                  hasDropdown
                  disabled={!canFormatCells}
                  aria-label="Number format"
                  aria-expanded={numberFormatOpen}
                  aria-haspopup="listbox"
                />
              </Tooltip>
            ) : (
              // Full/Compact mode: Show dropdown with format name
              <Tooltip title="Number Format">
                <button
                  type="button"
                  data-testid="ribbon-dropdown-number-format"
                  onClick={() => setNumberFormatOpen(!numberFormatOpen)}
                  disabled={!canFormatCells}
                  className={`
 h-7 px-2 ${isCompactMode ? 'min-w-[70px]' : 'min-w-[90px]'}
 flex items-center justify-between gap-1
 border rounded
 text-ss-text-secondary text-ribbon
 cursor-pointer outline-none disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed disabled:pointer-events-none
 transition-colors duration-ss-fast
 ${
   numberFormatOpen
     ? 'bg-ss-primary-light border-ss-primary ring-1 ring-ss-primary text-ss-primary'
     : 'bg-ss-surface border-ss-border hover:bg-ss-surface-hover'
 }
 `}
                  aria-label="Number format"
                  aria-expanded={numberFormatOpen}
                  aria-haspopup="listbox"
                >
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                    {formatDisplayName}
                  </span>
                  <DropdownArrowIcon />
                </button>
              </Tooltip>
            )}
            <RibbonDropdownPanel open={numberFormatOpen} onClose={() => setNumberFormatOpen(false)}>
              <div data-testid="ribbon-dropdown-menu-number-format">
                <NumberFormatPanel
                  currentFormat={numberFormat}
                  sampleValue={sampleValue}
                  recentFormats={recentNumberFormats}
                  onApply={(formatCode) => {
                    if (!canFormatCells) return;
                    dispatch('SET_NUMBER_FORMAT', { format: formatCode });
                    setNumberFormatOpen(false);
                  }}
                  onClose={() => setNumberFormatOpen(false)}
                />
              </div>
            </RibbonDropdownPanel>
          </div>
        </RibbonVisibilityItem>

        {/* Row 2: Quick format buttons */}
        <div className="flex items-center gap-[var(--ribbon-button-inline-gap)]">
          <div className="relative inline-flex">
            <Tooltip title="Currency Format" description="Format as currency ($)">
              <SplitButton
                icon={<CurrencyIcon />}
                variant="small"
                isOpen={currencyDropdownOpen}
                aria-label="Currency format"
                disabled={!canFormatCells}
                onMainClick={() => {
                  if (canFormatCells) dispatch('FORMAT_CURRENCY');
                }}
                onDropdownClick={() => {
                  if (canFormatCells) setCurrencyDropdownOpen(!currencyDropdownOpen);
                }}
              />
            </Tooltip>
            <RibbonDropdownPanel
              open={currencyDropdownOpen}
              onClose={() => setCurrencyDropdownOpen(false)}
            >
              <div role="menu" className="py-1">
                {TOOLBAR_CURRENCY_OPTIONS.map((option) => (
                  <RibbonDropdownItem
                    key={option.code}
                    closeOnClick={false}
                    disabled={!canFormatCells}
                    onClick={() => {
                      if (!canFormatCells) return;
                      dispatch('SET_NUMBER_FORMAT', { format: option.format });
                      setCurrencyDropdownOpen(false);
                    }}
                  >
                    {option.symbol} {option.code}
                  </RibbonDropdownItem>
                ))}
              </div>
            </RibbonDropdownPanel>
          </div>

          <Tooltip title="Percent Format" description="Format as percentage (%)">
            <RibbonButton
              id="percent-format"
              layout="icon-only"
              icon={<PercentIcon />}
              onClick={() => {
                if (canFormatCells) dispatch('FORMAT_PERCENTAGE');
              }}
              disabled={!canFormatCells}
              aria-label="Percent format"
            />
          </Tooltip>

          <Tooltip title="Comma Format" description="Format with comma separators (1,000)">
            <RibbonButton
              id="comma-format"
              layout="icon-only"
              icon={<CommaStyleIcon />}
              onClick={() => {
                if (canFormatCells) dispatch('FORMAT_COMMA');
              }}
              disabled={!canFormatCells}
              aria-label="Comma format"
            />
          </Tooltip>

          {/* Separator */}
          <div className="w-px h-6 bg-ss-surface-tertiary mx-1" />

          <Tooltip title="Increase Decimal Places">
            <RibbonButton
              id="increase-decimals"
              layout="icon-only"
              icon={<DecimalIncreaseIcon />}
              onClick={() => {
                if (canFormatCells) dispatch('INCREASE_DECIMALS');
              }}
              disabled={!canFormatCells}
              aria-label="Increase decimal places"
            />
          </Tooltip>

          <Tooltip title="Decrease Decimal Places">
            <RibbonButton
              id="decrease-decimals"
              layout="icon-only"
              icon={<DecimalDecreaseIcon />}
              onClick={() => {
                if (canFormatCells) dispatch('DECREASE_DECIMALS');
              }}
              disabled={!canFormatCells}
              aria-label="Decrease decimal places"
            />
          </Tooltip>
        </div>
      </div>
    </ToolbarGroup>
  );
});
