/**
 * Context Menu Types
 *
 * Type definitions for the cell/row/column context menu.
 * Context menu state is stored in UIStore (ephemeral, not collaborative).
 *
 * @module components/context-menu/types
 */

import type { ReactNode } from 'react';

// =============================================================================
// Shared types from contracts (canonical definitions)
// =============================================================================

import type {
  ContextMenuState as ContractContextMenuState,
  ContextMenuTarget as ContractContextMenuTarget,
} from '@mog-sdk/contracts/context-menu';

export type ContextMenuState = ContractContextMenuState;
export type ContextMenuTarget = ContractContextMenuTarget;

// =============================================================================
// Menu Item Types
// =============================================================================

/**
 * A single menu item in the context menu.
 */
export interface ContextMenuItem {
  /** Unique identifier for the menu item */
  id: string;
  /** Display label */
  label: string;
  /** Optional icon to show before label */
  icon?: ReactNode;
  /** Keyboard shortcut hint (e.g., "Ctrl+C") */
  shortcut?: string;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Whether this is a destructive action (shows in red) */
  danger?: boolean;
  /** Show a divider after this item */
  dividerAfter?: boolean;
  /** Stable selector for app evals */
  testId?: string;
  /** Click handler */
  onClick: () => void;
  /** Submenu items (for nested menus like "Unhide rows") */
  children?: ContextMenuItem[];
  /**
   * Whether the item is checked (for toggle states).
   * When defined, shows a checkmark column on the left.
   */
  checked?: boolean;
}

/**
 * A divider in the menu (just for organization).
 */
export interface ContextMenuDivider {
  type: 'divider';
}

/**
 * Either a menu item or a divider.
 */
export type ContextMenuElement = ContextMenuItem | ContextMenuDivider;

/**
 * Type guard to check if element is a divider.
 */
export function isDivider(element: ContextMenuElement): element is ContextMenuDivider {
  return 'type' in element && element.type === 'divider';
}

// =============================================================================
// Component Props
// =============================================================================

/**
 * Props for the CellContextMenu component.
 * Position is handled by Radix ContextMenu (from the native right-click event).
 */
export interface CellContextMenuProps {
  /** What type of element was right-clicked */
  target: ContextMenuTarget;
  /** Row index if applicable */
  targetRow?: number;
  /** Column index if applicable */
  targetCol?: number;
  /** Called when menu should close */
  onClose: () => void;
}
