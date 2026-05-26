/**
 * FillContextMenu Component
 *
 * Context menu shown when user right-click drags the fill handle.
 * Provides fill options like Copy Cells, Fill Series, Fill Formatting Only, etc.
 * Shows date-specific options (Fill Days, Weekdays, Months, Years) when dates are detected.
 *
 * Right-Click Drag Fill Context Menu
 *
 * ARCHITECTURE:
 * - Uses dispatch() for all actions (Unified Action System)
 * - Menu position is at the mouse release location
 * - Closes on selection, Escape, or click outside
 * - Date options are conditionally shown based on source data
 * - Uses Radix DropdownMenu with virtual trigger for keyboard nav and ARIA semantics
 */

import { useCallback, useMemo } from 'react';

import { CopySvg, FillSeriesSvg, FormatCellsSvg, PasteValuesSvg, wrapIcon } from '@mog/icons';

import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useUIStore } from '../../infra/context';
import type { FillOptionType } from '../../ui-store/slices/view/fill-context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mog/shell/components/ui';

// =============================================================================
// Icon Components
// =============================================================================

const CopyIcon = wrapIcon(CopySvg, 'toolbar');
const FillSeriesIcon = wrapIcon(FillSeriesSvg, 'toolbar');
const FormattingIcon = wrapIcon(FormatCellsSvg, 'toolbar');
const ValuesIcon = wrapIcon(PasteValuesSvg, 'toolbar');

// =============================================================================
// Types
// =============================================================================

interface FillOptionItem {
  key: FillOptionType;
  label: string;
  icon?: React.ReactNode;
  /** If true, only show when dates are detected */
  dateOnly?: boolean;
  /** If true, show a divider after this item */
  dividerAfter?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Fill context menu options.
 * Matches Excel's right-drag fill context menu.
 */
const FILL_OPTIONS: FillOptionItem[] = [
  { key: 'copy_cells', label: 'Copy Cells', icon: <CopyIcon /> },
  { key: 'fill_series', label: 'Fill Series', icon: <FillSeriesIcon />, dividerAfter: true },
  { key: 'formatting_only', label: 'Fill Formatting Only', icon: <FormattingIcon /> },
  {
    key: 'without_formatting',
    label: 'Fill Without Formatting',
    icon: <ValuesIcon />,
    dividerAfter: true,
  },
  // Date-specific options (only shown when dates detected)
  { key: 'fill_days', label: 'Fill Days', dateOnly: true },
  { key: 'fill_weekdays', label: 'Fill Weekdays', dateOnly: true },
  { key: 'fill_months', label: 'Fill Months', dateOnly: true },
  { key: 'fill_years', label: 'Fill Years', dateOnly: true, dividerAfter: true },
  // Trend options (always shown, for numeric data)
  { key: 'linear_trend', label: 'Linear Trend' },
  { key: 'growth_trend', label: 'Growth Trend' },
];

/**
 * Map fill option types to action types.
 */
const OPTION_TO_ACTION: Record<FillOptionType, string> = {
  copy_cells: 'EXECUTE_FILL_COPY_CELLS',
  // Uses EXECUTE_FILL_SERIES_CONTEXT_MENU to avoid conflict with dialog's EXECUTE_FILL_SERIES
  fill_series: 'EXECUTE_FILL_SERIES_CONTEXT_MENU',
  formatting_only: 'EXECUTE_FILL_FORMATTING_ONLY',
  without_formatting: 'EXECUTE_FILL_WITHOUT_FORMATTING',
  fill_days: 'EXECUTE_FILL_DAYS',
  fill_weekdays: 'EXECUTE_FILL_WEEKDAYS',
  fill_months: 'EXECUTE_FILL_MONTHS',
  fill_years: 'EXECUTE_FILL_YEARS',
  linear_trend: 'EXECUTE_FILL_LINEAR_TREND',
  growth_trend: 'EXECUTE_FILL_GROWTH_TREND',
};

// MenuItem removed - using Radix DropdownMenuItem instead

// =============================================================================
// Component
// =============================================================================

export function FillContextMenu() {
  const deps = useActionDependencies();

  // Get fill context menu state from UIStore
  const fillContextMenu = useUIStore((s) => s.fillContextMenu);
  const hideFillContextMenu = useUIStore((s) => s.hideFillContextMenu);

  // Build the menu items based on whether dates are detected
  const menuItems = useMemo(() => {
    return FILL_OPTIONS.filter((option) => {
      // Show non-date options always
      if (!option.dateOnly) return true;
      // Show date options only when dates are detected
      return fillContextMenu.hasDateValues;
    });
  }, [fillContextMenu.hasDateValues]);

  // Handle menu item click
  const handleOptionClick = useCallback(
    (optionKey: FillOptionType) => {
      // Dispatch the appropriate action
      const actionType = OPTION_TO_ACTION[optionKey];
      if (actionType) {
        // Pass the fill context (source, target, direction) as payload
        dispatch(actionType as Parameters<typeof dispatch>[0], deps, {
          sourceRange: fillContextMenu.sourceRange,
          targetCorners: fillContextMenu.targetCorners,
          direction: fillContextMenu.direction,
        });
      }
      // Close the menu
      hideFillContextMenu();
    },
    [deps, fillContextMenu, hideFillContextMenu],
  );

  // Handle close
  const handleClose = useCallback(() => {
    hideFillContextMenu();
  }, [hideFillContextMenu]);

  // Don't render if not open
  if (!fillContextMenu.isOpen || !fillContextMenu.position) {
    return null;
  }

  return (
    <DropdownMenu open={fillContextMenu.isOpen} onOpenChange={(open) => !open && handleClose()}>
      {/* Virtual trigger positioned at mouse release coordinates */}
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: fillContextMenu.position.x,
            top: fillContextMenu.position.y,
            width: 1,
            height: 1,
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={0}
        className="py-1 min-w-[180px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {menuItems.map((item, index) => (
          <div key={item.key}>
            <DropdownMenuItem icon={item.icon} onSelect={() => handleOptionClick(item.key)}>
              {item.label}
            </DropdownMenuItem>
            {item.dividerAfter && index < menuItems.length - 1 && <DropdownMenuSeparator />}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
