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
 * - Uses Draft + Apply pattern: stores pending config in UIStore, then dispatches
 * - Pre-populates ConditionFilterPanel with selected operator
 * - Switches FilterDropdown to "conditions" tab
 */

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { FilterOperator } from '@mog-sdk/contracts/filter';
import React from 'react';
import { useUIStore } from '../../infra/context';
import { MenuItem, MenuSeparator } from '@mog/shell/components/ui';

export interface TextFiltersMenuProps {
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
 * Text filters submenu with operator shortcuts
 *
 * Uses Draft + Apply pattern:
 * 1. Store pending config in UIStore via setPendingFilterConfig
 * 2. For condition panel: call onSwitchToConditions to let user enter value
 */
export function TextFiltersMenu({
  filterId,
  headerCellId,
  onClose,
  onSwitchToConditions,
}: TextFiltersMenuProps): React.ReactElement {
  const setPendingFilterConfig = useUIStore((s) => s.setPendingFilterConfig);

  /**
   * Handle operator selection.
   * Switch to condition panel to let user enter value.
   */
  const handleSelect = (operator: FilterOperator) => {
    // Store pending config in UIStore (Draft step)
    setPendingFilterConfig({
      filterId,
      headerCellId,
      type: 'text',
      operator,
    });

    if (onSwitchToConditions) {
      // Let parent component switch to condition panel for value input
      onSwitchToConditions(operator);
    }
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
