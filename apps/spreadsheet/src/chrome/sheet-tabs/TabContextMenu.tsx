/**
 * TabContextMenu Component
 *
 * Full context menu for sheet tabs with:
 * - Insert: Add new sheet
 * - Delete: Remove sheet (disabled if last sheet)
 * - Rename: Start inline edit
 * - Copy: Duplicate sheet
 * - Hide: Hide sheet (disabled if last visible)
 * - Unhide...: Show unhide dialog (disabled if no hidden sheets)
 * - Tab Color: Color picker submenu
 *
 * Tab Strip Enhancement
 */

import { useCallback, useRef, useState } from 'react';
import { dispatch, useActionDependencies } from '../../internal-api';

import { createVirtualRef, Popover, PopoverAnchor, PopoverContent } from '@mog/shell';

import { TabColorPicker } from './TabColorPicker';

// =============================================================================
// Helpers
// =============================================================================

/** Narrow UIStore state to the methods we need here. */
function getUIState(deps: { uiStore?: { getState(): unknown } }): {
  setPendingProtectSheetId: (sheetId: string) => void;
} {
  const state = deps.uiStore?.getState();
  return state as { setPendingProtectSheetId: (sheetId: string) => void };
}

// =============================================================================
// Types
// =============================================================================

export interface TabContextMenuProps {
  /** X position (clientX) */
  x: number;
  /** Y position (clientY) */
  y: number;
  /** Whether menu is open */
  isOpen: boolean;
  /** Target sheet ID */
  sheetId: string;
  /** Current tab color */
  tabColor?: string | null;
  /** Number of visible sheets (to control Hide option) */
  visibleSheetCount: number;
  /** Number of hidden sheets (to control Unhide option) */
  hiddenSheetCount: number;
  /**
   * Number of selected sheets (for grouped sheet operations)
   * When > 1, menu items show plural labels (e.g., "Delete Sheets" instead of "Delete")
   */
  selectedSheetCount?: number;
  /**
   * Whether workbook structure is protected.
   * When true, all structure operations (Insert, Delete, Rename, Move or Copy, Hide, Unhide)
   * are disabled.
   */
  isWorkbookStructureProtected?: boolean;
  /** Whether the target sheet is currently protected (toggles Protect/Unprotect label and action). */
  isSheetProtected?: boolean;

  // Actions
  onClose: () => void;
  onInsert: () => void;
  onDelete: () => void;
  onRename: () => void;
  onCopy: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onSetTabColor: (color: string | null) => void;
  onOpenMoveOrCopy: (sheetId: string) => void;
}

// =============================================================================
// Menu Item Components
// =============================================================================

interface MenuItemProps {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  shortcut?: string;
}

function MenuItem({ children, onClick, disabled, destructive, shortcut }: MenuItemProps) {
  return (
    <button
      className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-dropdown
 ${disabled ? 'text-ss-text-disabled cursor-not-allowed' : 'hover:bg-ss-surface-hover cursor-pointer'}
 ${destructive && !disabled ? 'text-ss-error hover:bg-ss-error-bg' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      role="menuitem"
    >
      <span className="flex-1">{children}</span>
      {shortcut && (
        <kbd className="ml-auto pl-4 text-ribbon-compact text-ss-text-tertiary">{shortcut}</kbd>
      )}
    </button>
  );
}

function MenuDivider() {
  return <div className="h-px bg-ss-border my-1 mx-2" />;
}

// =============================================================================
// Component
// =============================================================================

export function TabContextMenu({
  x,
  y,
  isOpen,
  sheetId,
  tabColor,
  visibleSheetCount,
  hiddenSheetCount,
  selectedSheetCount = 1,
  isWorkbookStructureProtected = false,
  isSheetProtected = false,
  onClose,
  onInsert,
  onDelete,
  onRename,
  onCopy,
  onHide,
  onUnhide,
  onSetTabColor,
  onOpenMoveOrCopy,
}: TabContextMenuProps) {
  // Multi-Sheet Selection - determine if we're in group mode
  const isGrouped = selectedSheetCount > 1;
  const deps = useActionDependencies();
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Create virtual ref for positioning
  const virtualRef = useRef(createVirtualRef(x, y));
  // Update virtual ref when position changes
  if (isOpen) {
    virtualRef.current = createVirtualRef(x, y);
  }

  const handleAction = useCallback(
    (action: () => void) => {
      action();
      onClose();
    },
    [onClose],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
        setShowColorPicker(false);
      }
    },
    [onClose],
  );

  const canDelete = visibleSheetCount > 1 && !isWorkbookStructureProtected;
  const canHide = visibleSheetCount > 1 && !isWorkbookStructureProtected;
  const canUnhide = hiddenSheetCount > 0 && !isWorkbookStructureProtected;

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={0}
        className="py-1 min-w-[160px]"
        role="menu"
        data-testid="context-menu"
      >
        {/* Insert */}
        <MenuItem onClick={() => handleAction(onInsert)} disabled={isWorkbookStructureProtected}>
          Insert
        </MenuItem>

        {/* Delete - show plural when grouped */}
        <MenuItem
          onClick={() => handleAction(onDelete)}
          disabled={!canDelete}
          destructive
          shortcut="Del"
        >
          {isGrouped ? `Delete ${selectedSheetCount} Sheets` : 'Delete'}
        </MenuItem>

        {/* Rename - disabled when grouped (can't rename multiple) or when workbook structure is protected */}
        <MenuItem
          onClick={() => handleAction(onRename)}
          shortcut="F2"
          disabled={isGrouped || isWorkbookStructureProtected}
        >
          Rename
        </MenuItem>

        <MenuDivider />

        {/* Move or Copy - disabled when workbook structure is protected */}
        <MenuItem
          onClick={() => {
            onOpenMoveOrCopy(sheetId);
            onClose();
          }}
          disabled={isWorkbookStructureProtected}
        >
          Move or Copy...
        </MenuItem>

        {/* View Code - placeholder (disabled) */}
        <MenuItem disabled onClick={() => {}}>
          View Code
        </MenuItem>

        <MenuDivider />

        {/* Protect / Unprotect Sheet */}
        <MenuItem
          onClick={() => {
            if (isSheetProtected) {
              dispatch('OPEN_UNPROTECT_SHEET_DIALOG', deps, { sheetId });
            } else {
              getUIState(deps).setPendingProtectSheetId(sheetId);
              dispatch('OPEN_PROTECT_SHEET_DIALOG', deps);
            }
            onClose();
          }}
        >
          {isSheetProtected ? 'Unprotect Sheet' : 'Protect Sheet'}
        </MenuItem>

        <MenuDivider />

        {/* Copy - show plural when grouped. Disabled when workbook structure is protected */}
        <MenuItem onClick={() => handleAction(onCopy)} disabled={isWorkbookStructureProtected}>
          {isGrouped ? `Copy ${selectedSheetCount} Sheets` : 'Copy'}
        </MenuItem>

        <MenuDivider />

        {/* Hide - show plural when grouped */}
        <MenuItem onClick={() => handleAction(onHide)} disabled={!canHide}>
          {isGrouped ? `Hide ${selectedSheetCount} Sheets` : 'Hide'}
        </MenuItem>

        {/* Unhide */}
        <MenuItem onClick={() => handleAction(onUnhide)} disabled={!canUnhide}>
          Unhide...
        </MenuItem>

        <MenuDivider />

        {/* Tab Color - with submenu */}
        <div className="relative">
          <button
            className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-dropdown ${
              isWorkbookStructureProtected
                ? 'text-ss-text-disabled cursor-not-allowed'
                : 'hover:bg-ss-surface-hover cursor-pointer'
            }`}
            onClick={
              isWorkbookStructureProtected ? undefined : () => setShowColorPicker(!showColorPicker)
            }
            disabled={isWorkbookStructureProtected}
            aria-disabled={isWorkbookStructureProtected || undefined}
            role="menuitem"
          >
            <span className="flex-1">Tab Color</span>
            <span className="text-ss-text-secondary">{'>'}</span>
          </button>
          {showColorPicker && (
            <div
              className="absolute left-full top-0 ml-1"
              onMouseLeave={() => setShowColorPicker(false)}
            >
              <TabColorPicker
                currentColor={tabColor}
                onColorSelect={(color) => {
                  onSetTabColor(color);
                  onClose();
                }}
                onClose={onClose}
              />
            </div>
          )}
        </div>

        <MenuDivider />

        {/* Select All Sheets */}
        <MenuItem
          onClick={() => {
            dispatch('SELECT_ALL_SHEETS', deps);
            onClose();
          }}
        >
          Select All Sheets
        </MenuItem>
      </PopoverContent>
    </Popover>
  );
}
