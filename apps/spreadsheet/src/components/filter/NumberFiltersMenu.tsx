/**
 * NumberFiltersMenu Component
 *
 * B4: Filter Dropdown Panel - Number-specific filter shortcuts
 *
 * Provides a submenu with common number filter operations:
 * - Equals, Does Not Equal
 * - Greater Than, Less Than, Between
 * - Top 10, Above/Below Average
 *
 * ARCHITECTURE:
 * - Uses Draft + Apply pattern: stores pending config in UIStore, then dispatches
 * - Pre-populates ConditionFilterPanel with selected operator
 * - Switches FilterDropdown to "conditions" tab
 */

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { FilterOperator } from '@mog-sdk/contracts/filter';
import React from 'react';
import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useUIStore } from '../../infra/context';
import { MenuItem, MenuSeparator } from '@mog/shell/components/ui';

export interface NumberFiltersMenuProps {
  /** Filter ID from the filter dropdown context */
  filterId: string;
  /** Header cell ID from the filter dropdown context */
  headerCellId: CellId;
  /** Called to close the submenu */
  onClose: () => void;
  /** Called when user wants to switch to condition panel with pre-selected operator */
  onSwitchToConditions?: (operator: FilterOperator) => void;
}

/**
 * Number filters submenu with operator shortcuts
 *
 * Uses Draft + Apply pattern:
 * 1. Store pending config in UIStore via setPendingFilterConfig
 * 2. For immediate apply: dispatch APPLY_NUMBER_FILTER
 * 3. For condition panel: call onSwitchToConditions to let user enter value
 */
export function NumberFiltersMenu({
  filterId,
  headerCellId,
  onClose,
  onSwitchToConditions,
}: NumberFiltersMenuProps): React.ReactElement {
  const deps = useActionDependencies();
  const setPendingFilterConfig = useUIStore((s) => s.setPendingFilterConfig);

  /**
   * Handle operator selection.
   * For most operators, switch to condition panel to let user enter value.
   * For special cases like Top 10, open the dialog.
   */
  const handleSelect = (operator: FilterOperator) => {
    // Store pending config in UIStore (Draft step)
    setPendingFilterConfig({
      filterId,
      headerCellId,
      type: 'number',
      operator,
    });

    if (onSwitchToConditions) {
      // Let parent component switch to condition panel for value input
      onSwitchToConditions(operator);
    }
    onClose();
  };

  /**
   * Handle Top 10 selection - opens the Top 10 dialog
   */
  const handleTop10 = () => {
    // Open Top 10 dialog via dispatch
    dispatch('OPEN_TOP10_DIALOG', deps);
    onClose();
  };

  /**
   * Handle Custom Filter selection - opens the Custom AutoFilter dialog
   */
  const handleCustomFilter = () => {
    // Get column index from headerCellId
    // For now, we'll pass a placeholder columnIndex (0) since the dialog uses filterId
    // The action handler will resolve the actual column position from the headerCellId
    dispatch('OPEN_CUSTOM_AUTOFILTER_DIALOG', deps, {
      filterId,
      columnIndex: 0, // This will be resolved by the action handler
      columnName: 'Column', // Optional, can be improved
    });
    onClose();
  };

  return (
    <div className="number-filters-menu flex flex-col">
      <MenuItem onSelect={() => handleSelect('equals')}>Equals...</MenuItem>
      <MenuItem onSelect={() => handleSelect('notEquals')}>Does Not Equal...</MenuItem>
      <MenuItem onSelect={() => handleSelect('greaterThan')}>Greater Than...</MenuItem>
      <MenuItem onSelect={() => handleSelect('greaterThanOrEqual')}>
        Greater Than Or Equal To...
      </MenuItem>
      <MenuItem onSelect={() => handleSelect('lessThan')}>Less Than...</MenuItem>
      <MenuItem onSelect={() => handleSelect('lessThanOrEqual')}>Less Than Or Equal To...</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => handleSelect('between')}>Between...</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={handleTop10}>Top 10...</MenuItem>
      {/* Above/Below Average - one-click filter operations */}
      <MenuItem onSelect={() => handleSelect('aboveAverage')}>Above Average</MenuItem>
      <MenuItem onSelect={() => handleSelect('belowAverage')}>Below Average</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={handleCustomFilter}>Custom Filter...</MenuItem>
    </div>
  );
}
