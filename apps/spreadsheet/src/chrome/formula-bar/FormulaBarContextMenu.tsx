/**
 * Formula Bar Context Menu Component
 *
 * Right-click context menu for the formula bar input field.
 * Provides text editing operations (Cut, Copy, Paste, Select All) and
 * access to the Insert Function dialog.
 *
 * Architecture:
 * - Menu state: Local component state (not global UIStore)
 * - Text operations: Native browser APIs via use-formula-bar-context-menu-actions hook
 * - Insert Function: Unified action system via dispatch()
 *
 * @see engine/src/components/context-menu/CellContextMenu.tsx - Context menu pattern reference
 */

import { useCallback, useRef } from 'react';

import { CopySvg, CutSvg, PasteFormulasSvg, PasteSvg, wrapIcon } from '@mog/icons';

import { createVirtualRef, Popover, PopoverAnchor, PopoverContent } from '@mog/shell';

// =============================================================================
// Icon Components
// =============================================================================

const CutIcon = wrapIcon(CutSvg, 'toolbar');
const CopyIcon = wrapIcon(CopySvg, 'toolbar');
const PasteIcon = wrapIcon(PasteSvg, 'toolbar');
// Use PasteFormulasSvg as a function icon placeholder (fx symbol)
const FunctionIcon = wrapIcon(PasteFormulasSvg, 'toolbar');

// =============================================================================
// Types
// =============================================================================

export interface FormulaBarContextMenuProps {
  /** X position in viewport */
  x: number;
  /** Y position in viewport */
  y: number;
  /** Called when menu should close */
  onClose: () => void;

  // Action handlers
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onInsertFunction: () => void;

  // State for enabling/disabling menu items
  hasSelection: boolean;
  canPaste: boolean;
}

// =============================================================================
// Menu Item Components
// =============================================================================

interface MenuItemProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  shortcut?: string;
}

function MenuItem({ children, icon, onClick, disabled, shortcut }: MenuItemProps) {
  return (
    <button
      className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-dropdown
 ${disabled ? 'text-ss-text-disabled cursor-not-allowed' : 'hover:bg-ss-surface-hover cursor-pointer'}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      role="menuitem"
    >
      {icon && <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>}
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

/**
 * FormulaBarContextMenu - Context menu for formula bar text operations.
 *
 * Menu items (Excel parity):
 * - Cut (Ctrl+X) - Disabled if no text selected
 * - Copy (Ctrl+C) - Disabled if no text selected
 * - Paste (Ctrl+V)
 * - Divider
 * - Select All (Ctrl+A)
 * - Divider
 * - Insert Function... (Shift+F3)
 *
 * @example
 * ```tsx
 * <FormulaBarContextMenu
 * x={mouseX}
 * y={mouseY}
 * onClose={handleClose}
 * onCut={actions.cut}
 * onCopy={actions.copy}
 * onPaste={actions.paste}
 * onSelectAll={actions.selectAll}
 * onInsertFunction={actions.insertFunction}
 * hasSelection={actions.hasSelection}
 * canPaste={actions.canPaste}
 * />
 * ```
 */
export function FormulaBarContextMenu({
  x,
  y,
  onClose,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
  onInsertFunction,
  hasSelection,
  canPaste,
}: FormulaBarContextMenuProps) {
  // Create virtual ref for positioning
  const virtualRef = useRef(createVirtualRef(x, y));
  virtualRef.current = createVirtualRef(x, y);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <Popover open={true} onOpenChange={handleOpenChange}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={0}
        className="py-1 min-w-[180px]"
        role="menu"
      >
        {/* Cut */}
        <MenuItem
          icon={<CutIcon />}
          shortcut="Ctrl+X"
          disabled={!hasSelection}
          onClick={() => {
            onCut();
            onClose();
          }}
        >
          Cut
        </MenuItem>

        {/* Copy */}
        <MenuItem
          icon={<CopyIcon />}
          shortcut="Ctrl+C"
          disabled={!hasSelection}
          onClick={() => {
            onCopy();
            onClose();
          }}
        >
          Copy
        </MenuItem>

        {/* Paste */}
        <MenuItem
          icon={<PasteIcon />}
          shortcut="Ctrl+V"
          disabled={!canPaste}
          onClick={() => {
            onPaste();
            onClose();
          }}
        >
          Paste
        </MenuItem>

        <MenuDivider />

        {/* Select All */}
        <MenuItem
          shortcut="Ctrl+A"
          onClick={() => {
            onSelectAll();
            onClose();
          }}
        >
          Select All
        </MenuItem>

        <MenuDivider />

        {/* Insert Function */}
        <MenuItem
          icon={<FunctionIcon />}
          shortcut="Shift+F3"
          onClick={() => {
            onInsertFunction();
            onClose();
          }}
        >
          Insert Function...
        </MenuItem>
      </PopoverContent>
    </Popover>
  );
}
