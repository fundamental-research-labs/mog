/**
 * ConditionalFormattingMenu
 *
 * Dropdown menu for conditional formatting options.
 * Provides quick access to Highlight Cell Rules, Top/Bottom Rules,
 * Data Bars, Color Scales, Icon Sets, and Rules Manager.
 *
 * Uses RibbonDropdown for consistent z-index and behavior.
 *
 * KEYTIPS:
 * - J = Open Conditional Formatting menu
 *
 * Foundation
 */

import React, { useCallback, useEffect } from 'react';

import { SectionLabel, Tooltip } from '@mog/shell';
import type {
  CFColorScalePreset,
  CFDataBarPreset,
  CFIconSetPreset,
} from '@mog-sdk/contracts/conditional-format';
import {
  COLOR_SCALE_PRESETS,
  DATA_BAR_PRESETS,
  ICON_SET_PRESETS,
} from '@mog/spreadsheet-utils/cf-presets';
import { CFPresetThumbnail } from '../../../dialogs/formatting/CFPresetThumbnail';
import {
  DEFAULT_HIGHLIGHT_STYLES,
  useConditionalFormatting,
} from '../../../hooks/data/use-conditional-formatting';
import { useUIStore } from '../../../internal-api';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import type { QuickRuleDialogType } from '../../../ui-store';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import {
  RibbonDropdown,
  RibbonDropdownDivider,
  RibbonDropdownItem,
  RibbonDropdownSubmenu,
} from '../primitives/RibbonDropdown';
import { StackedRibbonMenuButton } from '../primitives/StackedRibbonMenuButton';
import { ConditionalFormatIcon } from '../primitives/ToolbarIcons';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';

// =============================================================================
// Types
// =============================================================================

interface ConditionalFormattingMenuProps {
  /** Callback when CF dialog should open (existing flow) */
  onOpenCFDialog?: () => void;
  /** Compact three-row style used inside the Home ribbon Styles group. */
  variant?: 'button' | 'stacked';
}

// =============================================================================
// Submenu Items
// =============================================================================

const HIGHLIGHT_RULES: Array<{ label: string; type: QuickRuleDialogType; description: string }> = [
  {
    label: 'Greater Than...',
    type: 'greaterThan',
    description: 'Highlight cells greater than a value',
  },
  { label: 'Less Than...', type: 'lessThan', description: 'Highlight cells less than a value' },
  { label: 'Between...', type: 'between', description: 'Highlight cells between two values' },
  { label: 'Equal To...', type: 'equalTo', description: 'Highlight cells equal to a value' },
  {
    label: 'Text that Contains...',
    type: 'textContains',
    description: 'Highlight cells containing specific text',
  },
  {
    label: 'A Date Occurring...',
    type: 'dateOccurring',
    description: 'Highlight cells with dates in a specific period',
  },
  {
    label: 'Duplicate Values...',
    type: 'duplicates',
    description: 'Highlight duplicate or unique values',
  },
  {
    label: 'Blanks...',
    type: 'blanks',
    description: 'Highlight cells that are blank (or non-blank)',
  },
];

const TOP_BOTTOM_RULES: Array<{ label: string; type: QuickRuleDialogType; description: string }> = [
  { label: 'Top 10 Items...', type: 'topItems', description: 'Highlight top N items' },
  { label: 'Top 10%...', type: 'topPercent', description: 'Highlight top N percent' },
  { label: 'Bottom 10 Items...', type: 'bottomItems', description: 'Highlight bottom N items' },
  { label: 'Bottom 10%...', type: 'bottomPercent', description: 'Highlight bottom N percent' },
];

// =============================================================================
// Trigger Icon
// =============================================================================

export function ConditionalFormattingStackIcon() {
  return (
    <svg
      width="var(--ribbon-icon-size)"
      height="var(--ribbon-icon-size)"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1.5" y="2" width="13" height="12" rx="1" fill="#ffffff" stroke="#6b7280" />
      <path d="M5.8 2v12M10.2 2v12M1.5 6.1h13M1.5 10.4h13" stroke="#9ca3af" strokeWidth="0.7" />
      <rect x="2.4" y="2.9" width="2.6" height="2.4" fill="#f7c7c7" />
      <rect x="6.7" y="2.9" width="2.6" height="2.4" fill="#b7d7f0" />
      <rect x="11" y="6.9" width="2.6" height="2.7" fill="#f7c7c7" />
      <rect x="6.7" y="11.2" width="2.6" height="1.9" fill="#f7c7c7" />
    </svg>
  );
}

// =============================================================================
// Component
// =============================================================================

/**
 * Conditional formatting menu component with memo for performance optimization.
 * Prevents unnecessary re-renders when parent component updates.
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 */
export const ConditionalFormattingMenu = React.memo(function ConditionalFormattingMenu({
  onOpenCFDialog,
  variant = 'button',
}: ConditionalFormattingMenuProps) {
  // lifted into the ribbonDropdowns slice so the keytip chord
  // (Alt+H,J) can open the menu via OPEN_RIBBON_DROPDOWN.
  const isOpen = useUIStore((s) => s.ribbonDropdowns['home.conditional-formatting'] ?? false);
  const openRibbonDropdown = useUIStore((s) => s.openRibbonDropdown);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);
  const setIsOpen = useCallback(
    (open: boolean) =>
      open
        ? openRibbonDropdown('home.conditional-formatting')
        : closeRibbonDropdown('home.conditional-formatting'),
    [openRibbonDropdown, closeRibbonDropdown],
  );

  // Use dispatch for architecture alignment (instead of direct UIStore calls)
  const dispatch = useDispatch();

  // Direct UI store access for CF dialog / rules manager — both OPEN_CF_DIALOG and
  // OPEN_CF_RULES_MANAGER action handlers require deps.onUIAction to be wired, which
  // SpreadsheetCoordinatorProvider does NOT do. Call UIStore directly instead, consistent
  // with how CFRulesManager and CFPresetGallery open these dialogs.
  const openCFDialog = useUIStore((s) => s.openCFDialog);
  const openRulesManager = useUIStore((s) => s.openRulesManager);

  // Conditional formatting hook for instant-apply actions
  const cf = useConditionalFormatting();

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via the typed `KeyboardShortcut` entry in
  // `keyboard/definitions/keytips-home-groups.ts`.)
  // ===========================================================================

  useEffect(() => {
    keyTipRegistry.register({ key: 'J', tabId: 'home', elementId: 'conditional-formatting' });

    return () => {
      keyTipRegistry.unregister('J', 'home');
    };
  }, []);

  const handleQuickRule = useCallback(
    (type: QuickRuleDialogType) => {
      dispatch('OPEN_QUICK_RULE_DIALOG', { type });
      setIsOpen(false);
    },
    [dispatch],
  );

  const handleNewRule = useCallback(() => {
    if (onOpenCFDialog) {
      onOpenCFDialog();
    } else {
      openCFDialog('create');
    }
    setIsOpen(false);
  }, [onOpenCFDialog, openCFDialog]);

  const handleManageRules = useCallback(() => {
    openRulesManager();
    setIsOpen(false);
  }, [openRulesManager]);

  // Instant-apply handlers for Above/Below Average
  const handleAboveAverage = useCallback(() => {
    cf.applyAboveAverage(DEFAULT_HIGHLIGHT_STYLES.yellowFillDarkYellowText);
    setIsOpen(false);
  }, [cf]);

  const handleBelowAverage = useCallback(() => {
    cf.applyBelowAverage(DEFAULT_HIGHLIGHT_STYLES.lightRedFillDarkRedText);
    setIsOpen(false);
  }, [cf]);

  // Clear Rules handlers
  const handleClearFromSelection = useCallback(() => {
    cf.clearFromSelection();
    setIsOpen(false);
  }, [cf]);

  const handleClearFromSheet = useCallback(() => {
    cf.clearFromSheet();
    setIsOpen(false);
  }, [cf]);

  // Clear rules from table
  const handleClearFromTable = useCallback(() => {
    cf.clearFromTable();
    setIsOpen(false);
  }, [cf]);

  // Get table at selection for conditional rendering
  const tableAtSelection = cf.getTableAtSelection();

  // Trigger button: vertical RibbonButton by default, compact stack row in Styles.
  const trigger =
    variant === 'stacked' ? (
      <StackedRibbonMenuButton
        id="conditional-formatting"
        testId="ribbon-dropdown-conditional-formatting"
        icon={<ConditionalFormattingStackIcon />}
        label="Conditional Formatting"
        visibilityKey="conditionalFormatting"
        isOpen={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      />
    ) : (
      <Tooltip title="Conditional Formatting" description="Highlight cells based on rules">
        <RibbonButton
          layout="vertical"
          height="full"
          data-testid="ribbon-dropdown-conditional-formatting"
          icon={<ConditionalFormatIcon />}
          label={'Conditional\nFormatting'}
          hasDropdown
          dropdownPosition="inline"
          isOpen={isOpen}
          aria-label="Conditional Formatting"
        />
      </Tooltip>
    );

  const menu = (
    <div className="relative inline-flex">
      <RibbonDropdown open={isOpen} onOpenChange={setIsOpen} trigger={trigger} width={220}>
        {/* Wrapper carries the chrome-symmetry menu testid; the popover
 content renders this div inside its portal. role="presentation"
 keeps screen readers from seeing a non-menu element between the
 PopoverContent's role="menu" and the RibbonDropdownItem children's
 role="menuitem". */}
        <div role="presentation" data-testid="ribbon-dropdown-menu-conditional-formatting">
          {/* Highlight Cell Rules Submenu */}
          <RibbonDropdownSubmenu label="Highlight Cell Rules">
            {HIGHLIGHT_RULES.map((rule) => (
              <RibbonDropdownItem
                key={rule.type}
                onClick={() => handleQuickRule(rule.type)}
                testId={`cf-quick-rule-${rule.type}`}
              >
                {rule.label}
              </RibbonDropdownItem>
            ))}
          </RibbonDropdownSubmenu>

          {/* Top/Bottom Rules Submenu */}
          <RibbonDropdownSubmenu label="Top/Bottom Rules">
            {TOP_BOTTOM_RULES.map((rule) => (
              <RibbonDropdownItem key={rule.type} onClick={() => handleQuickRule(rule.type)}>
                {rule.label}
              </RibbonDropdownItem>
            ))}
            <RibbonDropdownDivider />
            <RibbonDropdownItem onClick={handleAboveAverage}>Above Average</RibbonDropdownItem>
            <RibbonDropdownItem onClick={handleBelowAverage}>Below Average</RibbonDropdownItem>
          </RibbonDropdownSubmenu>

          <RibbonDropdownDivider />

          {/* Data Bars Submenu */}
          <RibbonDropdownSubmenu label="Data Bars" className="w-[280px]">
            <div className="px-2 py-1.5">
              <SectionLabel size="sm">Gradient Fill</SectionLabel>
              <div className="flex gap-1 flex-wrap">
                {DATA_BAR_PRESETS.filter((p) => p.dataBar.gradient).map((preset) => (
                  <PresetButton
                    key={preset.id}
                    preset={preset}
                    onClick={() => {
                      cf.applyDataBar((preset as CFDataBarPreset).dataBar);
                      setIsOpen(false);
                    }}
                  />
                ))}
              </div>
              <SectionLabel size="sm" className="mt-3">
                Solid Fill
              </SectionLabel>
              <div className="flex gap-1 flex-wrap">
                {DATA_BAR_PRESETS.filter((p) => !p.dataBar.gradient).map((preset) => (
                  <PresetButton
                    key={preset.id}
                    preset={preset}
                    onClick={() => {
                      cf.applyDataBar((preset as CFDataBarPreset).dataBar);
                      setIsOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
            <RibbonDropdownDivider />
            <RibbonDropdownItem onClick={handleNewRule}>More Rules...</RibbonDropdownItem>
          </RibbonDropdownSubmenu>

          {/* Color Scales Submenu */}
          <RibbonDropdownSubmenu label="Color Scales" className="w-[280px]">
            <div className="px-2 py-1.5">
              <div className="flex gap-1 flex-wrap">
                {COLOR_SCALE_PRESETS.map((preset) => (
                  <PresetButton
                    key={preset.id}
                    preset={preset}
                    onClick={() => {
                      cf.applyColorScale((preset as CFColorScalePreset).colorScale);
                      setIsOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
            <RibbonDropdownDivider />
            <RibbonDropdownItem onClick={handleNewRule}>More Rules...</RibbonDropdownItem>
          </RibbonDropdownSubmenu>

          {/* Icon Sets Submenu */}
          <RibbonDropdownSubmenu label="Icon Sets" className="w-[320px]">
            <div className="px-2 py-1.5">
              <SectionLabel size="sm">Directional</SectionLabel>
              <div className="flex gap-1 flex-wrap">
                {ICON_SET_PRESETS.filter((p) => p.iconSet.iconSetName.includes('Arrow')).map(
                  (preset) => (
                    <PresetButton
                      key={preset.id}
                      preset={preset}
                      width={56}
                      onClick={() => {
                        cf.applyIconSet((preset as CFIconSetPreset).iconSet);
                        setIsOpen(false);
                      }}
                    />
                  ),
                )}
              </div>
              <SectionLabel size="sm" className="mt-3">
                Shapes
              </SectionLabel>
              <div className="flex gap-1 flex-wrap">
                {ICON_SET_PRESETS.filter(
                  (p) =>
                    p.iconSet.iconSetName.includes('Traffic') ||
                    p.iconSet.iconSetName.includes('Symbol') ||
                    p.iconSet.iconSetName.includes('Sign') ||
                    p.iconSet.iconSetName.includes('Flag'),
                ).map((preset) => (
                  <PresetButton
                    key={preset.id}
                    preset={preset}
                    width={56}
                    onClick={() => {
                      cf.applyIconSet((preset as CFIconSetPreset).iconSet);
                      setIsOpen(false);
                    }}
                  />
                ))}
              </div>
              <SectionLabel size="sm" className="mt-3">
                Ratings
              </SectionLabel>
              <div className="flex gap-1 flex-wrap">
                {ICON_SET_PRESETS.filter(
                  (p) =>
                    p.iconSet.iconSetName.includes('Rating') ||
                    p.iconSet.iconSetName.includes('Quarter') ||
                    p.iconSet.iconSetName.includes('Star') ||
                    p.iconSet.iconSetName.includes('Box') ||
                    p.iconSet.iconSetName.includes('Triangle') ||
                    p.iconSet.iconSetName.includes('RedToBlack'),
                ).map((preset) => (
                  <PresetButton
                    key={preset.id}
                    preset={preset}
                    width={56}
                    onClick={() => {
                      cf.applyIconSet((preset as CFIconSetPreset).iconSet);
                      setIsOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
            <RibbonDropdownDivider />
            <RibbonDropdownItem onClick={handleNewRule}>More Rules...</RibbonDropdownItem>
          </RibbonDropdownSubmenu>

          <RibbonDropdownDivider />

          {/* New Rule */}
          <RibbonDropdownItem onClick={handleNewRule}>New Rule...</RibbonDropdownItem>

          {/* Clear Rules Submenu */}
          <RibbonDropdownSubmenu label="Clear Rules">
            <RibbonDropdownItem onClick={handleClearFromSelection}>
              Clear Rules from Selected Cells
            </RibbonDropdownItem>
            <RibbonDropdownItem onClick={handleClearFromSheet}>
              Clear Rules from Entire Sheet
            </RibbonDropdownItem>
            {/* Show table-specific option only when selection is in a table */}
            {tableAtSelection && (
              <RibbonDropdownItem onClick={handleClearFromTable}>
                Clear Rules from This Table
              </RibbonDropdownItem>
            )}
          </RibbonDropdownSubmenu>

          {/* Manage Rules */}
          <RibbonDropdownItem onClick={handleManageRules}>Manage Rules...</RibbonDropdownItem>
        </div>
      </RibbonDropdown>
    </div>
  );

  return variant === 'stacked' ? (
    <RibbonVisibilityItem item="conditionalFormatting">{menu}</RibbonVisibilityItem>
  ) : (
    menu
  );
});

// =============================================================================
// Helper Components
// =============================================================================

interface PresetButtonProps {
  preset: CFDataBarPreset | CFColorScalePreset | CFIconSetPreset;
  onClick: () => void;
  width?: number;
}

/**
 * Clickable preset thumbnail button for the submenus.
 */
function PresetButton({ preset, onClick, width = 48 }: PresetButtonProps) {
  return (
    <button
      type="button"
      className="p-1 border border-transparent rounded cursor-pointer transition-all hover:bg-ss-surface-hover hover:border-ss-primary-light focus:outline-none focus:ring-2 focus:ring-ss-primary"
      onClick={onClick}
      title={preset.name}
    >
      <CFPresetThumbnail preset={preset} width={width} height={20} />
    </button>
  );
}
