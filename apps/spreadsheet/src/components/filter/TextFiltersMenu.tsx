/**
 * TextFiltersMenu Component
 *
 * B4: Filter Dropdown Panel - Text-specific filter shortcuts
 *
 * Provides a submenu with common text filter operations:
 * - Equals, Does Not Equal
 * - Begins With, Ends With, Contains
 *
 * ARCHITECTURE:
 * - Pre-populates ConditionFilterPanel with selected operator
 * - Switches the filter panel to the "conditions" tab
 */

import type { FilterOperator } from '@mog-sdk/contracts/filter';
import React from 'react';
import { MenuItem, MenuSeparator } from '@mog/shell/components/ui';

export interface TextFiltersMenuProps {
  /** Called to close the submenu */
  onClose: () => void;
  /** Called when user wants to switch to condition panel with pre-selected operator */
  onSwitchToConditions?: (operator: FilterOperator) => void;
}

/**
 * Text filters submenu with operator shortcuts
 *
 * Operator items switch the owning filter panel to ConditionFilterPanel so the
 * user can enter values in one local flow.
 */
export function TextFiltersMenu({
  onClose,
  onSwitchToConditions,
}: TextFiltersMenuProps): React.ReactElement {
  const handleSelect = (operator: FilterOperator) => {
    onSwitchToConditions?.(operator);
    onClose();
  };

  return (
    <div className="text-filters-menu flex flex-col">
      <MenuItem onSelect={() => handleSelect('equals')}>Equals...</MenuItem>
      <MenuItem onSelect={() => handleSelect('notEquals')}>Does Not Equal...</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => handleSelect('startsWith')}>Begins With...</MenuItem>
      <MenuItem onSelect={() => handleSelect('endsWith')}>Ends With...</MenuItem>
      <MenuItem onSelect={() => handleSelect('contains')}>Contains...</MenuItem>
      <MenuItem onSelect={() => handleSelect('notContains')}>Does Not Contain...</MenuItem>
    </div>
  );
}
