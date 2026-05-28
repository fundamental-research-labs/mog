/**
 * Tab Component
 *
 * A single sheet tab with:
 * - Click to select
 * - Double-click to rename (inline edit)
 * - Right-click context menu
 * - Drag-and-drop reordering
 * - Tab color indicator (bottom border)
 *
 * Tab Strip Enhancement
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';

import { Icon, Input } from '@mog/shell';

const MAX_SHEET_NAME_LENGTH = 31;
const INVALID_SHEET_NAME_CHARS = /[\\/?*\[\]:]/;

function isStaticSheetNameValid(name: string): boolean {
  return name.length <= MAX_SHEET_NAME_LENGTH && !INVALID_SHEET_NAME_CHARS.test(name);
}

// =============================================================================
// Types
// =============================================================================

export interface TabProps {
  id: string;
  name: string;
  isActive: boolean;
  /** Whether this sheet is part of multi-sheet selection */
  isSelected?: boolean;
  /** Whether this sheet is protected */
  isProtected?: boolean;
  /** Whether workbook structure protection is active (blocks rename via double-click) */
  isWorkbookStructureProtected?: boolean;
  tabColor?: string | null;
  index: number;
  /** When true, immediately enters edit mode (for context menu rename) */
  forceEditing?: boolean;

  // Events
  onSelect: (e: React.MouseEvent) => void;
  onRename: (newName: string) => Promise<boolean>;
  /** Called when editing ends (commit or cancel) */
  onEditingEnd?: () => void;
  /**
   * Push a focus layer when the rename input mounts.
   * Wired to FocusCoordination.pushFocusLayer('sheetTabs', id).
   * Required so concurrent `focusGrid()` calls (e.g. from the sheet-switch
   * coordinator that fires when the first click of the dblclick activates
   * the tab) don't steal DOM focus from the just-mounted rename input.
   */
  onRenameInputMounted?: () => void;
  /** Pop the focus layer pushed by `onRenameInputMounted`. */
  onRenameInputUnmounted?: () => void;
  onContextMenu: (x: number, y: number) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function Tab({
  id,
  name,
  isActive,
  isSelected,
  isProtected,
  isWorkbookStructureProtected,
  tabColor,
  index,
  forceEditing,
  onSelect,
  onRename,
  onEditingEnd,
  onRenameInputMounted,
  onRenameInputUnmounted,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
}: TabProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle forceEditing prop (from context menu Rename)
  useEffect(() => {
    if (forceEditing && !isEditing) {
      setIsEditing(true);
      setEditValue(name);
    }
  }, [forceEditing, isEditing, name]);

  // Focus input when editing starts; push a focus layer for the lifetime of
  // the rename input so concurrent `focusGrid()` calls don't steal DOM focus
  // from the just-mounted input. Pop on unmount/teardown.
  useEffect(() => {
    if (isEditing && inputRef.current) {
      onRenameInputMounted?.();
      inputRef.current.focus();
      inputRef.current.select();
      return () => {
        onRenameInputUnmounted?.();
      };
    }
    return undefined;
  }, [isEditing, onRenameInputMounted, onRenameInputUnmounted]);

  // Update edit value when name changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(name);
    }
  }, [name, isEditing]);

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  // Suppress the synthetic click that fires after a drag-reorder release —
  // pointer-capture causes browsers to dispatch a `click` on the dragged
  // element after `pointerup`, which would otherwise re-trigger activation.
  const suppressNextClickRef = useRef(false);

  // Sheet-tab activation is synchronous on every click — Excel parity, no
  // timing window. removed the 220 / 300 ms `setTimeout` that
  // race-condition'd with keyboard shortcuts (Ctrl+V, Ctrl+PageDown) firing
  // before the timer expired. The double-click rename gesture is detected
  // via React's synthetic `e.detail` (browsers send the second click with
  // detail=2 BEFORE `dblclick`), so we never need to defer activation: the
  // handler below activates on detail===1 and bails on detail>=2.
  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (isEditing) return;
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      // detail >= 2: second click of a double-click — rename gesture, not
      // activation. The first click of the dblclick already activated.
      if (e.detail >= 2) return;
      onSelect(e);
    },
    [isEditing, onSelect],
  );

  const handleDoubleClick = useCallback(() => {
    if (isWorkbookStructureProtected) return;
    setIsEditing(true);
    setEditValue(name);
  }, [name, isWorkbookStructureProtected]);

  const handleContextMenuEvent = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e.clientX, e.clientY);
    },
    [onContextMenu],
  );

  const handleRenameSubmit = useCallback(async () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      if (!isStaticSheetNameValid(trimmed)) {
        setEditValue(name);
        setIsEditing(false);
        onEditingEnd?.();
        return;
      }
      const ok = await onRename(trimmed);
      if (!ok) return;
    }
    setIsEditing(false);
    onEditingEnd?.();
  }, [editValue, name, onRename, onEditingEnd]);

  const handleRenameKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleRenameSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsEditing(false);
        setEditValue(name);
        onEditingEnd?.();
      }
    },
    [handleRenameSubmit, name, onEditingEnd],
  );

  const handleInputClick = useCallback((e: MouseEvent<HTMLInputElement>) => {
    e.stopPropagation();
  }, []);

  // ===========================================================================
  // Pointer-driven drag-and-drop reorder
  //
  // HTML5 native DnD is unreliable: Chromium does not synthesize
  // `dragstart`/`dragover`/`drop` from `mouse.down/move/up`, so Playwright
  // (and many touch / embedded contexts) cannot drive a reorder. We replace
  // it with pointer events that work uniformly across input modalities.
  // ===========================================================================

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startedDrag: boolean;
    lastTargetIndex: number;
  } | null>(null);

  // Threshold (px) below which a pointermove counts as a click, not a drag.
  const DRAG_THRESHOLD_PX = 4;

  /**
   * Resolve the tab index currently under `clientX` by inspecting the parent
   * `[role="tablist"]`'s children. Returns the dragged tab's own index when
   * the pointer is outside any tab's horizontal extent.
   */
  const findTabIndexAtX = useCallback(
    (clientX: number): number => {
      const button = buttonRef.current;
      if (!button) return index;
      const tablist = button.closest('[role="tablist"]');
      if (!tablist) return index;
      const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
      for (let i = 0; i < tabs.length; i++) {
        const r = tabs[i].getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right) return i;
      }
      // Past the last tab → drop at the end.
      if (tabs.length > 0) {
        const last = tabs[tabs.length - 1].getBoundingClientRect();
        if (clientX > last.right) return tabs.length - 1;
        const first = tabs[0].getBoundingClientRect();
        if (clientX < first.left) return 0;
      }
      return index;
    },
    [index],
  );

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (isEditing) return;
      // Only initiate drag on primary (left) pointer button.
      if (e.button !== 0) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startedDrag: false,
        lastTargetIndex: index,
      };
    },
    [isEditing, index],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      const dx = e.clientX - drag.startX;
      if (!drag.startedDrag) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        drag.startedDrag = true;
        setIsDragging(true);
        onDragStart(index);
        // Capture so we keep getting moves even if pointer leaves the button.
        try {
          buttonRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort */
        }
      }

      const targetIndex = findTabIndexAtX(e.clientX);
      if (targetIndex !== drag.lastTargetIndex) {
        drag.lastTargetIndex = targetIndex;
        onDragOver(targetIndex);
      }
    },
    [findTabIndexAtX, index, onDragOver],
  );

  const finishDrag = useCallback(
    (pointerId: number, committed: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== pointerId) return;
      const wasDragging = drag.startedDrag;
      dragRef.current = null;
      try {
        buttonRef.current?.releasePointerCapture(pointerId);
      } catch {
        /* release is best-effort */
      }
      if (wasDragging) {
        setIsDragging(false);
        // Browsers fire a synthetic `click` after pointer-capture release;
        // suppress its activation so a drag never doubles as a tab switch.
        suppressNextClickRef.current = true;
        if (committed) onDrop();
      }
    },
    [onDrop],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      finishDrag(e.pointerId, true);
    },
    [finishDrag],
  );

  const handlePointerCancel = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      finishDrag(e.pointerId, false);
    },
    [finishDrag],
  );

  // ===========================================================================
  // Compute Styles
  // ===========================================================================

  // Bottom border for active tab or tab color
  const borderBottomColor = isActive
    ? tabColor || 'var(--color-ss-primary)'
    : tabColor || 'transparent';
  const borderBottomWidth = isActive || tabColor ? '3px' : '0';

  // Determine if this tab should show selected styling
  // A tab is visually selected if it's part of multi-selection OR it's the active tab
  const showSelectedStyle = isSelected || isActive;

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenuEvent}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className={`
 flex items-center gap-1 h-7 px-3 border-none rounded-t bg-transparent cursor-pointer
 text-sheet-tab text-ss-text-secondary transition-colors duration-ss-fast whitespace-nowrap
 shrink-0 relative select-none
 ${isActive ? 'bg-ss-surface text-text' : showSelectedStyle ? 'bg-ss-surface-secondary text-text' : 'hover:bg-ss-surface-hover'}
 ${isDragging ? 'opacity-50' : ''}
 `}
      aria-selected={isActive}
      role="tab"
      data-testid={`tab-${id}`}
    >
      {isEditing ? (
        <Input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={handleRenameSubmit}
          onClick={handleInputClick}
          className="h-5 !px-1 !py-0 text-sheet-tab min-w-[60px] max-w-[150px]"
          aria-label="Sheet name"
          data-testid={`tab-input-${id}`}
        />
      ) : (
        <>
          {/* Lock icon for protected sheets */}
          {isProtected && (
            <Icon
              name="lock"
              size="xs"
              className="text-ss-text-tertiary"
              aria-label="Protected sheet"
            />
          )}
          <span>{name}</span>
          {/* Tab color indicator —
 `data-testid="tab-color-indicator"` lets the harness observer
 `getTabColorDOM` read the rendered backgroundColor via
 `getComputedStyle` without reading kernel/UIStore state. */}
          <div
            className="absolute bottom-0 left-0 right-0 rounded-b-sm"
            data-testid="tab-color-indicator"
            style={{
              backgroundColor: borderBottomColor,
              height: borderBottomWidth,
            }}
          />
        </>
      )}
    </button>
  );
}
