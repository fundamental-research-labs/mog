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
 * - Pre-populates ConditionFilterPanel with selected operator
 * - Switches the filter panel to the "conditions" tab
 */

import type { FilterOperator } from '@mog-sdk/contracts/filter';
import React from 'react';
import { MenuItem, MenuSeparator } from '@mog/shell/components/ui';

export interface NumberFiltersMenuProps {
  /** Called to close the submenu */
  onClose: () => void;
  /** Called when user wants to switch to condition panel with pre-selected operator */
  onSwitchToConditions?: (operator: FilterOperator) => void;
  /** Called when user wants to configure a Top/Bottom N filter */
  onOpenTop10?: () => void;
}

/**
 * Number filters submenu with operator shortcuts
 *
 * Operator items switch the owning filter panel to ConditionFilterPanel so the
 * user can enter values in one local flow.
 */
export function NumberFiltersMenu({
  onClose,
  onSwitchToConditions,
  onOpenTop10,
}: NumberFiltersMenuProps): React.ReactElement {
  const handleSelect = (operator: FilterOperator) => {
    onSwitchToConditions?.(operator);
    onClose();
  };

  const handleTop10 = () => {
    onOpenTop10?.();
    onClose();
  };

  /**
   * Handle Custom Filter selection - switch to the local condition panel.
   */
  const handleCustomFilter = () => {
    onSwitchToConditions?.('equals');
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
