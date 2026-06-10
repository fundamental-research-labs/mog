/**
 * TabStrip Component
 *
 * Main container for sheet tabs with:
 * - Scrollable tab list with scroll buttons
 * - Add sheet button
 * - Context menu management
 * - Drag-and-drop reordering
 * - Unhide dialog
 * - Multi-sheet selection (Ctrl+click, Shift+click) -
 *
 * Implements SheetTabsProps contract from contracts/index.ts
 *
 * Tab Strip Enhancement
 * Editor & Protection - Multi-sheet selection
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { dispatch, useActionDependencies, useCoordinator } from '../../internal-api';

import { Button, usePlatformInfo } from '@mog/shell';
import { ArrowLeftSvg, ArrowRightSvg } from '@mog/icons';
import { useSheetSelection } from '../../hooks/selection/use-sheet-selection';
import { useAllSheetsProtection } from '../../hooks/structure/use-sheet-protection';
import { useWorkbookStructureProtection } from '../../hooks/structure/use-workbook-protection';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type { SheetTabsProps } from '../../internal-api';

import { MoveOrCopySheetDialog } from './MoveOrCopySheetDialog';
import { Tab } from './Tab';
import { TabContextMenu } from './TabContextMenu';
import { UnhideSheetDialog } from './UnhideSheetDialog';

// =============================================================================
// Helpers
// =============================================================================

/** Narrow UIStore state to the methods we need here. */
function getUIState(deps: { uiStore?: { getState(): unknown } }): {
  setPendingMoveSheet: (params: { sourceSheetId: string; beforeSheetId: string | null }) => void;
  setPendingCopySheet: (params: {
    sourceSheetId: string;
    beforeSheetId: string | null;
    newName: string;
  }) => void;
} {
  const state = deps.uiStore?.getState();
  return state as {
    setPendingMoveSheet: (params: { sourceSheetId: string; beforeSheetId: string | null }) => void;
    setPendingCopySheet: (params: {
      sourceSheetId: string;
      beforeSheetId: string | null;
      newName: string;
    }) => void;
  };
}

// =============================================================================
// Types
// =============================================================================

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  sheetId: SheetId;
}

interface DragState {
  isDragging: boolean;
  sourceIndex: number;
  targetIndex: number;
}

// =============================================================================
// ScrollButton Component
// =============================================================================

interface ScrollButtonProps {
  direction: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}

function ScrollButton({ direction, disabled, onClick }: ScrollButtonProps) {
  const ScrollIcon = direction === 'left' ? ArrowLeftSvg : ArrowRightSvg;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-ss-border bg-ss-surface text-ss-text shadow-ss-sm transition-colors duration-ss-fast hover:border-ss-border-hover hover:bg-ss-surface-hover active:bg-ss-surface-active disabled:cursor-not-allowed disabled:text-ss-text-tertiary disabled:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ss-primary focus-visible:ring-offset-1"
      aria-label={`Scroll tabs ${direction}`}
    >
      <ScrollIcon className="h-3.5 w-3.5" aria-hidden="true" focusable="false" />
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

export function TabStrip({
  sheets,
  activeSheetId,
  onSelectSheet,
  onAddSheet,
  onRenameSheet,
  onDeleteSheet,
  onReorderSheets,
  onCopySheet,
  onSetTabColor,
  onHideSheet,
  onUnhideSheet,
  hiddenSheets = [],
  readOnly = false,
}: SheetTabsProps) {
  // ===========================================================================
  // State
  // ===========================================================================

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    sheetId: toSheetId(''),
  });

  const [showUnhideDialog, setShowUnhideDialog] = useState(false);
  const [moveOrCopyDialogOpen, setMoveOrCopyDialogOpen] = useState(false);
  const [moveOrCopyDialogSheetId, setMoveOrCopyDialogSheetId] = useState<SheetId | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [editingSheetId, setEditingSheetId] = useState<SheetId | null>(null);

  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    sourceIndex: -1,
    targetIndex: -1,
  });

  const tabListRef = useRef<HTMLDivElement>(null);

  // ===========================================================================
  // Multi-Sheet Selection
  // ===========================================================================

  const deps = useActionDependencies();
  const {
    selectSheet,
    toggleSheet,
    selectRange,
    isSheetSelected,
    selectedSheetIds,
    hasMultipleSelection,
  } = useSheetSelection();

  // ===========================================================================
  // Sheet Protection
  // ===========================================================================

  const { isSheetProtected } = useAllSheetsProtection();
  const isWorkbookStructureProtected = useWorkbookStructureProtection();
  const coordinator = useCoordinator();

  const handleRenameInputMounted = useCallback(() => {
    coordinator.input.pushFocusLayer('sheetTabs', 'sheet-tab-rename');
  }, [coordinator]);
  const handleRenameInputUnmounted = useCallback(() => {
    coordinator.input.popFocusLayer();
  }, [coordinator]);

  const { isMacOS } = usePlatformInfo();

  // Track the "anchor" sheet for Shift+click range selection
  const [selectionAnchor, setSelectionAnchor] = useState<SheetId | null>(null);

  // Multi-Sheet Selection - Add [Group] indicator to document title when sheets are grouped
  useEffect(() => {
    if (hasMultipleSelection) {
      // Append [Group] to document title if not already present
      if (!document.title.includes('[Group]')) {
        document.title = document.title + ' - [Group]';
      }
    } else {
      // Remove [Group] from document title
      document.title = document.title.replace(' - [Group]', '');
    }
  }, [hasMultipleSelection]);

  /**
   * Handle tab click with multi-selection support.
   * - Regular click: select single sheet
   * - Ctrl+click (Cmd on Mac): toggle sheet in selection
   * - Shift+click: select range from anchor to clicked sheet
   */
  const handleTabClick = useCallback(
    (sheetId: SheetId, e: MouseEvent) => {
      const isCtrlOrCmd = isMacOS ? e.metaKey : e.ctrlKey;
      const isShift = e.shiftKey;

      if (isCtrlOrCmd) {
        // Ctrl/Cmd+click: toggle selection
        toggleSheet(sheetId);
        // Update anchor
        setSelectionAnchor(sheetId);
      } else if (isShift && selectionAnchor) {
        // Shift+click: select range from anchor
        selectRange(selectionAnchor, sheetId);
      } else {
        // Regular click: select single sheet.
        selectSheet(sheetId);
        setSelectionAnchor(sheetId);
        // Always set active sheet on regular click
        onSelectSheet(sheetId);
      }

      // If Ctrl+click or Shift+click, we may need to set active sheet too
      // (the clicked sheet becomes the active sheet)
      if (isCtrlOrCmd || isShift) {
        onSelectSheet(sheetId);
      }
    },
    [isMacOS, toggleSheet, selectRange, selectSheet, selectionAnchor, onSelectSheet, activeSheetId],
  );

  // ===========================================================================
  // Scroll Management
  // ===========================================================================

  const updateScrollButtons = useCallback(() => {
    const tabList = tabListRef.current;
    if (!tabList) return;

    const { scrollLeft, scrollWidth, clientWidth } = tabList;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  useEffect(() => {
    const tabList = tabListRef.current;
    if (!tabList) return;

    // Initial check
    updateScrollButtons();

    // Listen for scroll events
    tabList.addEventListener('scroll', updateScrollButtons);

    // Listen for resize
    const resizeObserver = new ResizeObserver(updateScrollButtons);
    resizeObserver.observe(tabList);

    return () => {
      tabList.removeEventListener('scroll', updateScrollButtons);
      resizeObserver.disconnect();
    };
  }, [updateScrollButtons, sheets]);

  const scrollLeft = useCallback(() => {
    tabListRef.current?.scrollBy({ left: -100, behavior: 'smooth' });
  }, []);

  const scrollRight = useCallback(() => {
    tabListRef.current?.scrollBy({ left: 100, behavior: 'smooth' });
  }, []);

  // Scroll active tab into view when it changes
  useEffect(() => {
    const tabList = tabListRef.current;
    if (!tabList) return;

    const activeTab = tabList.querySelector(`[data-testid="tab-${activeSheetId}"]`);
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeSheetId]);

  // ===========================================================================
  // Context Menu Handlers
  // ===========================================================================

  const handleContextMenu = useCallback(
    (sheetId: SheetId, x: number, y: number) => {
      // In read-only mode, don't show the context menu (all items are mutation actions)
      if (readOnly) return;
      setContextMenu({
        isOpen: true,
        x,
        y,
        sheetId,
      });
    },
    [readOnly, isWorkbookStructureProtected],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleContextMenuInsert = useCallback(() => {
    onAddSheet();
  }, [onAddSheet]);

  const handleContextMenuDelete = useCallback(() => {
    if (contextMenu.sheetId) {
      onDeleteSheet(contextMenu.sheetId);
    }
  }, [contextMenu.sheetId, onDeleteSheet]);

  const handleContextMenuRename = useCallback(() => {
    // Set editing sheet ID to trigger forceEditing on the Tab component
    setEditingSheetId(contextMenu.sheetId);
  }, [contextMenu.sheetId]);

  const handleEditingEnd = useCallback(() => {
    setEditingSheetId(null);
  }, []);

  const handleContextMenuCopy = useCallback(() => {
    if (contextMenu.sheetId && onCopySheet) {
      onCopySheet(contextMenu.sheetId);
    }
  }, [contextMenu.sheetId, onCopySheet]);

  const handleContextMenuHide = useCallback(() => {
    if (contextMenu.sheetId && onHideSheet) {
      onHideSheet(contextMenu.sheetId);
    }
  }, [contextMenu.sheetId, onHideSheet]);

  const handleContextMenuUnhide = useCallback(() => {
    setShowUnhideDialog(true);
  }, []);

  const handleSetTabColor = useCallback(
    (color: string | null) => {
      if (contextMenu.sheetId && onSetTabColor) {
        onSetTabColor(contextMenu.sheetId, color);
      }
    },
    [contextMenu.sheetId, onSetTabColor],
  );

  // ===========================================================================
  // Drag-and-Drop Handlers
  // ===========================================================================

  const handleDragStart = useCallback(
    (index: number) => {
      if (readOnly || isWorkbookStructureProtected) return;
      setDragState({
        isDragging: true,
        sourceIndex: index,
        targetIndex: index,
      });
    },
    [readOnly, isWorkbookStructureProtected],
  );

  const handleDragOver = useCallback((index: number) => {
    setDragState((prev) => ({
      ...prev,
      targetIndex: index,
    }));
  }, []);

  const handleDrop = useCallback(() => {
    if (dragState.sourceIndex !== dragState.targetIndex) {
      onReorderSheets?.(dragState.sourceIndex, dragState.targetIndex);
    }
    setDragState({
      isDragging: false,
      sourceIndex: -1,
      targetIndex: -1,
    });
  }, [dragState.sourceIndex, dragState.targetIndex, onReorderSheets]);

  // ===========================================================================
  // Tab Handlers
  // ===========================================================================

  const handleRename = useCallback(
    async (sheetId: SheetId, newName: string): Promise<boolean> => {
      const ok = await onRenameSheet(sheetId, newName);
      if (ok) setEditingSheetId(null);
      return ok;
    },
    [onRenameSheet],
  );

  // ===========================================================================
  // Unhide Dialog
  // ===========================================================================

  const handleUnhide = useCallback(
    (sheetId: string) => {
      if (onUnhideSheet) {
        onUnhideSheet(toSheetId(sheetId));
      }
    },
    [onUnhideSheet],
  );

  // ===========================================================================
  // Move or Copy Dialog
  // ===========================================================================

  const handleOpenMoveOrCopy = useCallback((sheetId: string) => {
    setMoveOrCopyDialogSheetId(toSheetId(sheetId));
    setMoveOrCopyDialogOpen(true);
  }, []);

  const handleCloseMoveOrCopy = useCallback(() => {
    setMoveOrCopyDialogOpen(false);
    setMoveOrCopyDialogSheetId(null);
  }, []);

  // ===========================================================================
  // Render
  // ===========================================================================

  const activeSheet = sheets.find((s) => s.id === contextMenu.sheetId);

  return (
    <div className="flex items-center h-8 bg-ss-surface-secondary border-t border-ss-border-light px-1 gap-0.5">
      {/* Scroll Left Button */}
      <ScrollButton direction="left" disabled={!canScrollLeft} onClick={scrollLeft} />

      {/* Tab List */}
      <div className="flex-1 overflow-hidden relative">
        <div
          ref={tabListRef}
          className="flex items-center gap-0.5 overflow-x-auto scroll-smooth scrollbar-none"
          role="tablist"
          aria-label="Sheet tabs"
        >
          {sheets.map((sheet, index) => (
            <Tab
              key={sheet.id}
              id={sheet.id}
              name={sheet.name}
              isActive={sheet.id === activeSheetId}
              isSelected={isSheetSelected(sheet.id)}
              isProtected={isSheetProtected(sheet.id)}
              isWorkbookStructureProtected={isWorkbookStructureProtected}
              tabColor={sheet.tabColor}
              index={index}
              forceEditing={editingSheetId === sheet.id}
              onSelect={(e) => handleTabClick(sheet.id, e)}
              onRename={(newName) => handleRename(sheet.id, newName)}
              onEditingEnd={handleEditingEnd}
              onRenameInputMounted={handleRenameInputMounted}
              onRenameInputUnmounted={handleRenameInputUnmounted}
              onContextMenu={(x, y) => handleContextMenu(sheet.id, x, y)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
          ))}
        </div>
      </div>

      {/* Scroll Right Button */}
      <ScrollButton direction="right" disabled={!canScrollRight} onClick={scrollRight} />

      {/* Group Indicator - shown when multiple sheets are selected */}
      {hasMultipleSelection && (
        <span
          className="shrink-0 px-2 py-0.5 text-caption font-medium text-ss-primary bg-ss-primary-light rounded"
          title={`${selectedSheetIds.length} sheets grouped`}
        >
          [Group]
        </span>
      )}

      {/* Add Sheet Button — hidden in read-only mode, disabled when workbook structure is protected */}
      {!readOnly && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddSheet}
          disabled={isWorkbookStructureProtected}
          aria-disabled={isWorkbookStructureProtected || undefined}
          className="w-6 h-6 p-0 shrink-0 text-body-lg font-light"
          title="Add sheet"
          aria-label="Add sheet"
        >
          +
        </Button>
      )}

      {/* Context Menu */}
      <TabContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        isOpen={contextMenu.isOpen}
        sheetId={contextMenu.sheetId}
        tabColor={activeSheet?.tabColor}
        visibleSheetCount={sheets.length}
        hiddenSheetCount={hiddenSheets.length}
        selectedSheetCount={selectedSheetIds.length}
        isWorkbookStructureProtected={isWorkbookStructureProtected}
        isSheetProtected={isSheetProtected(contextMenu.sheetId)}
        onClose={closeContextMenu}
        onInsert={handleContextMenuInsert}
        onDelete={handleContextMenuDelete}
        onRename={handleContextMenuRename}
        onCopy={handleContextMenuCopy}
        onHide={handleContextMenuHide}
        onUnhide={handleContextMenuUnhide}
        onSetTabColor={handleSetTabColor}
        onOpenMoveOrCopy={handleOpenMoveOrCopy}
      />

      {/* Unhide Dialog */}
      <UnhideSheetDialog
        isOpen={showUnhideDialog}
        hiddenSheets={hiddenSheets}
        onUnhide={handleUnhide}
        onClose={() => setShowUnhideDialog(false)}
      />

      {/* Move or Copy Dialog */}
      {moveOrCopyDialogOpen && moveOrCopyDialogSheetId && (
        <MoveOrCopySheetDialog
          isOpen={moveOrCopyDialogOpen}
          sourceSheetId={moveOrCopyDialogSheetId}
          sourceSheetName={sheets.find((s) => s.id === moveOrCopyDialogSheetId)?.name ?? ''}
          sheets={sheets}
          onClose={handleCloseMoveOrCopy}
          onMove={(sourceSheetId, beforeSheetId) => {
            getUIState(deps).setPendingMoveSheet({ sourceSheetId, beforeSheetId });
            dispatch('MOVE_SHEET', deps);
            handleCloseMoveOrCopy();
          }}
          onCopy={(sourceSheetId, beforeSheetId, newName) => {
            getUIState(deps).setPendingCopySheet({ sourceSheetId, beforeSheetId, newName });
            dispatch('COPY_SHEET_TO_POSITION', deps);
            handleCloseMoveOrCopy();
          }}
        />
      )}

      {/* Hide webkit scrollbar via inline style */}
      <style>{`
 [role="tablist"]::-webkit-scrollbar {
 display: none;
 }
 `}</style>
    </div>
  );
}
