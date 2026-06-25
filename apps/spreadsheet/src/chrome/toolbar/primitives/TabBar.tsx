/**
 * TabBar
 *
 * Top bar with quick access buttons (undo/redo), tabs, and print/export actions.
 * Migrated to Tailwind CSS with UI primitives.
 *
 * Extended to support ribbon display modes:
 * - In tabs-only mode: clicking a tab shows ribbon temporarily
 * - Double-click on tabs toggles between full and tabs-only mode
 */

import type { MouseEvent } from 'react';
import React, { useCallback, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { dispatch, useDocumentContext, useFeatureGate } from '../../../internal-api';

import { Button } from '@mog/shell';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import type { UndoHistoryEntry } from '../../../ui-store';
import { UndoDropdown } from '../galleries/UndoDropdown';
import { keyTipRegistry } from '../keytips';
import { AvatarList } from '../../collab/AvatarList';
import { CollaborateButton } from '../../collab/CollaborateButton';
import { useCollabStore } from '../../collab/use-collab-store';
import { RibbonVisibilityPathItem } from '../visibility/RibbonVisibilityContext';
import { RibbonCollapseToggle } from './RibbonCollapseToggle';
import { RibbonDisplayOptions } from './RibbonDisplayOptions';
import {
  ChevronDownIcon,
  DownloadIcon,
  PdfIcon,
  PrintIcon,
  RedoIcon,
  SaveIcon,
  SpinnerIcon,
  UndoIcon,
} from './ToolbarIcons';

// =============================================================================
// Constants
// =============================================================================

/**
 * Excel 365 KeyTip mapping for tabs.
 * Maps tab IDs to their keytip sequences.
 *
 * Standard tabs use single letters:
 * - H=Home, N=Insert, P=Page Layout,
 * - M=Formulas, A=Data, R=Review, W=View
 *
 * Contextual tabs use multi-key sequences starting with J:
 * - JT=Table Design (when in table)
 * - JC=Chart Design (when chart selected)
 *
 * Note: `F` (File) is NOT in this map — the File affordance is a
 * standalone backstage-trigger button rendered alongside the tab list,
 * not a `role="tab"` element. Its keytip badge is registered explicitly
 * in the `useEffect` below alongside the tab loop.
 */
export const TAB_KEYTIP_MAP: Record<string, string> = {
  home: 'H',
  insert: 'N',
  page: 'P',
  formulas: 'M',
  data: 'A',
  review: 'R',
  view: 'W',
  help: 'X',
  'table-design': 'JT', // Multi-key sequence (J followed by T)
  'chart-design': 'JC', // Multi-key sequence (J followed by C)
  'chart-format': 'JF', // Multi-key sequence (J followed by F)
  'pivot-analyze': 'JY', // Multi-key sequence (J followed by Y)
  'pivot-design': 'JV', // Multi-key sequence (J followed by V)
};

// =============================================================================
// Types
// =============================================================================

export interface TabBarProps<T extends string> {
  /** Available tabs */
  tabs: Array<{ id: T; label: string; isContextual?: boolean }>;
  /** Currently active tab */
  activeTab: T;
  /** Called when tab is selected */
  onTabChange: (tab: T) => void;
  /** Called when File tab is clicked (opens backstage) */
  onFileClick?: () => void;

  // Undo/Redo
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;

  // Undo History Dropdown
  undoHistory?: UndoHistoryEntry[];
  undoDropdownOpen?: boolean;
  onOpenUndoDropdown?: () => void;
  onCloseUndoDropdown?: () => void;
  onUndoToEntry?: (entryId: string) => void;

  // Save action
  onSave?: () => void;
  isSaving?: boolean;

  // Print/Export actions
  onPrint?: () => void;
  isPrinting?: boolean;
  onPdfExport?: () => void;
  isPdfExporting?: boolean;
  onExport?: () => void;
  isExporting?: boolean;
  /** Override for print button click (e.g., to open dialog) */
  onPrintClick?: () => void;
}

// =============================================================================
// Component
// =============================================================================

function TabBarImpl<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  onFileClick,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  undoHistory = [],
  undoDropdownOpen = false,
  onOpenUndoDropdown,
  onCloseUndoDropdown,
  onUndoToEntry,
  onSave,
  isSaving = false,
  onPrint,
  isPrinting = false,
  onPdfExport,
  isPdfExporting = false,
  onExport,
  isExporting = false,
  onPrintClick,
}: TabBarProps<T>) {
  const hasUndoDropdown = Boolean(onOpenUndoDropdown && onCloseUndoDropdown && onUndoToEntry);

  // Capability gates
  const showUndo = useFeatureGate('capabilities', 'undo');
  const showRedo = useFeatureGate('capabilities', 'redo');
  const showSave = useFeatureGate('capabilities', 'save');
  const showFileMenu = useFeatureGate('capabilities', 'fileMenu');
  const showPrint = useFeatureGate('capabilities', 'print');
  const showExport = useFeatureGate('capabilities', 'export');

  // unified keytip router: tab activation now flows through the
  // typed `SWITCH_RIBBON_TAB` action (definitions/ribbon.ts) so
  // `useKeyTips()` is no longer consulted here. The `showCommandKeyTips`
  // transition is owned by the coordinator's chord buffer.

  // Collab avatar bar — show remote participants next to CollaborateButton
  const collabEnabled = useCollabStore((s) => s.enabled);
  const allParticipants = useCollabStore((s) => s.participants);
  const localUserId = useCollabStore((s) => s.config?.user.userId ?? null);
  const remoteParticipants = React.useMemo(() => {
    if (!localUserId) return allParticipants;
    const filtered = new Map(allParticipants);
    filtered.delete(localUserId);
    return filtered;
  }, [allParticipants, localUserId]);

  // Get display mode state for tabs-only behavior
  const deps = useActionDependencies();
  const { uiStore } = useDocumentContext();
  const displayMode = useStore(uiStore, (s) => s.displayMode);
  const ribbonCollapsed = useStore(uiStore, (s) => s.ribbonCollapsed);

  // Double-click tracking for tabs toggle
  const lastClickTimeRef = useRef<number>(0);
  const lastClickTabRef = useRef<string | null>(null);
  const DOUBLE_CLICK_THRESHOLD = 300; // ms

  // Handle tab click with display mode awareness.
  // The File affordance is a standalone backstage-trigger button (rendered
  // outside the tab loop) with its own onClick — it never reaches this
  // handler, so there is no `isFileTab` branch here.
  const handleTabClick = useCallback(
    (tabId: T, event: MouseEvent<HTMLButtonElement>) => {
      // Only pointer-generated double-clicks should toggle ribbon tab mode.
      // Keyboard activation produces click events too, but detail is 0.
      const now = Date.now();
      const isDoubleClick =
        event.detail >= 2 &&
        lastClickTabRef.current === tabId &&
        now - lastClickTimeRef.current < DOUBLE_CLICK_THRESHOLD;

      lastClickTimeRef.current = now;
      lastClickTabRef.current = tabId as string;

      if (isDoubleClick) {
        // Double-click: toggle between full and tabs-only mode
        // Only works in full or tabs-only mode (not auto-hide)
        if (displayMode !== 'auto-hide') {
          dispatch('TOGGLE_RIBBON_TABS_MODE', deps);
        }
      } else {
        // Single click: switch tab
        onTabChange(tabId);

        if (ribbonCollapsed) {
          dispatch('TOGGLE_RIBBON', deps);
          return;
        }

        // In tabs-only mode, also show ribbon temporarily
        if (displayMode === 'tabs-only') {
          dispatch('SHOW_RIBBON_TEMPORARILY', deps);
        }
      }
    },
    [displayMode, ribbonCollapsed, onTabChange, deps],
  );

  const handleUndoClick = () => {
    onUndo?.();
  };

  const handleDropdownToggle = (e: MouseEvent) => {
    e.stopPropagation();
    if (undoDropdownOpen) {
      onCloseUndoDropdown?.();
    } else {
      onOpenUndoDropdown?.();
    }
  };

  const handleUndoToEntry = (entryId: string) => {
    onUndoToEntry?.(entryId);
  };

  const handleUndoAll = () => {
    // Undo to the last entry (oldest)
    if (undoHistory.length > 0 && onUndoToEntry) {
      onUndoToEntry(undoHistory[undoHistory.length - 1].id);
    }
  };

  // unified keytip router: keytip badges are still registered here
  // for the overlay's display-only layer, but the action callbacks are
  // no longer attached. The keyboard side fires
  // `SWITCH_RIBBON_TAB('<tabId>')` via the typed
  // `KeyboardShortcut` entries in `keyboard/definitions/ribbon.ts`,
  // and the consuming TabbedToolbar subscribes to
  // `useUIStore((s) => s.activeRibbonTab)`.
  //
  // The File button (`tab-file`) is registered explicitly here rather
  // than via the loop+TAB_KEYTIP_MAP path: File is not a `role="tab"`
  // element and is not part of the `tabs` array, but it shares the same
  // keytip overlay surface as the ribbon tabs (Excel-parity).
  useEffect(() => {
    tabs.forEach((tab) => {
      const key = TAB_KEYTIP_MAP[tab.id];
      if (!key) return;
      keyTipRegistry.register({
        key,
        elementId: `tab-${tab.id}`,
      });
    });
    if (showFileMenu) {
      keyTipRegistry.register({ key: 'F', elementId: 'tab-file' });
    }

    return () => {
      tabs.forEach((tab) => {
        const key = TAB_KEYTIP_MAP[tab.id];
        if (key) {
          keyTipRegistry.unregister(key);
        }
      });
      if (showFileMenu) {
        keyTipRegistry.unregister('F');
      }
    };
  }, [showFileMenu, tabs]);

  return (
    <div className="flex items-center h-[var(--tabbar-height)] px-2 bg-ss-surface-secondary min-w-0 overflow-hidden">
      {/* Quick access: Save/Undo/Redo - Excel-like compact buttons (gated by capabilities) */}
      <div
        data-testid="tabbar-quick-access"
        className="flex flex-shrink-0 gap-[var(--tabbar-button-group-gap)] mr-[var(--tabbar-section-margin)]"
      >
        {showSave && onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="
 flex items-center justify-center
 w-[var(--quick-access-button-size)] h-[var(--quick-access-button-size)]
 rounded-ss-sm bg-transparent
 cursor-pointer text-ss-text-secondary text-ribbon font-normal
 transition-all duration-ss-fast
 border border-transparent
 hover:bg-[var(--quick-access-hover-bg)] hover:border-[var(--quick-access-hover-border)]
 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-transparent
 "
            title="Save (Ctrl+S)"
            aria-label="Save"
          >
            {isSaving ? <SpinnerIcon /> : <SaveIcon />}
          </button>
        )}
        {/* Undo button with dropdown */}
        {showUndo && (
          <div className="relative flex">
            <button
              type="button"
              onClick={handleUndoClick}
              disabled={!canUndo}
              className={`
 flex items-center justify-center
 h-[var(--quick-access-button-size)] bg-transparent
 cursor-pointer text-ss-text-secondary text-ribbon font-normal
 transition-all duration-ss-fast
 border border-transparent
 hover:bg-[var(--quick-access-hover-bg)] hover:border-[var(--quick-access-hover-border)]
 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-transparent
 ${hasUndoDropdown ? 'w-[var(--quick-access-button-size)] rounded-l-sm' : 'w-[var(--quick-access-button-size)] rounded-ss-sm'}
 `}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <UndoIcon />
            </button>
            {hasUndoDropdown && (
              <button
                type="button"
                onClick={handleDropdownToggle}
                disabled={!canUndo && undoHistory.length === 0}
                className={`
 flex items-center justify-center
 w-3 h-[var(--quick-access-button-size)] p-0
 rounded-r-sm bg-transparent
 cursor-pointer text-ss-text-secondary text-ribbon font-normal
 transition-all duration-ss-fast
 border border-transparent border-l-0
 hover:bg-[var(--quick-access-hover-bg)] hover:border-[var(--quick-access-hover-border)] hover:border-l-0
 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-transparent
 ${undoDropdownOpen ? 'bg-ss-primary-light text-ss-primary border-ss-primary-light' : ''}
 `}
                title="Undo history"
                aria-label="Undo history dropdown"
                aria-expanded={undoDropdownOpen}
              >
                <ChevronDownIcon />
              </button>
            )}
            {hasUndoDropdown && onCloseUndoDropdown && (
              <UndoDropdown
                isOpen={undoDropdownOpen}
                history={undoHistory}
                onClose={onCloseUndoDropdown}
                onUndoToEntry={handleUndoToEntry}
                onUndoAll={handleUndoAll}
              />
            )}
          </div>
        )}
        {showRedo && (
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className="
 flex items-center justify-center
 w-[var(--quick-access-button-size)] h-[var(--quick-access-button-size)]
 rounded-ss-sm bg-transparent
 cursor-pointer text-ss-text-secondary text-ribbon font-normal
 transition-all duration-ss-fast
 border border-transparent
 hover:bg-[var(--quick-access-hover-bg)] hover:border-[var(--quick-access-hover-border)]
 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-transparent
 "
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
          >
            <RedoIcon />
          </button>
        )}
      </div>

      {/* Tabs */}
      {/*
 Expose the ribbon tab strip via WAI-ARIA tablist semantics so `readActiveRibbonTab`
 resolves the *ribbon* active tab. Without `role="tab"` on the
 ribbon buttons, scenario helpers would only find the *sheet* tab strip
 (chrome/sheet-tabs/Tab.tsx already uses role="tab") and return
 e.g. "Sheet1" instead of "Home", failing top-level-tabs alt scenarios
 regardless of routing correctness.
 Ribbon TabBar renders before the sheet-tab strip in TabbedToolbar,
 so the readback's first `aria-selected="true"` match wins for the
 ribbon. Existing data-testid attributes stay so the helper's
 `data-testid` preference is unaffected.
 */}
      {/* File button — a backstage trigger, NOT a ribbon tab.
 Rendered as a leading sibling of the tablist so it visually
 appears in the tab strip (Excel-parity) but is structurally
 a button: no `role="tab"`, no `aria-selected`, never reaches
 `handleTabClick`. Calls `onFileClick` directly. */}
      {showFileMenu && (
        <button
          id="tab-file"
          data-keytip="F"
          data-testid="file-menu-trigger"
          type="button"
          onClick={onFileClick}
          className={`
 relative px-[var(--tabbar-tab-padding-x)] py-[var(--tabbar-tab-padding-y)]
 flex-shrink-0 whitespace-nowrap
 cursor-pointer text-tab font-normal
 transition-all duration-ss-fast
 border border-transparent
 bg-[var(--tab-inactive-bg)] text-[var(--tab-inactive-text)]
 hover:bg-[var(--tab-hover-bg)] hover:text-text
 `}
        >
          File
        </button>
      )}
      <div
        role="tablist"
        aria-label="Command bar tabs"
        className="flex items-end h-full min-w-0 overflow-x-auto overflow-y-hidden scrollbar-none"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const isContextual = tab.isContextual;
          const keytip = TAB_KEYTIP_MAP[tab.id];

          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              data-keytip={keytip}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={(event) => handleTabClick(tab.id, event)}
              className={`
 relative px-[var(--tabbar-tab-padding-x)] py-[var(--tabbar-tab-padding-y)]
 flex-shrink-0 whitespace-nowrap
 cursor-pointer text-tab font-normal
 transition-all duration-ss-fast
 border border-transparent
 ${
   isActive
     ? `bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] font-medium`
     : `bg-[var(--tab-inactive-bg)] text-[var(--tab-inactive-text)] hover:bg-[var(--tab-hover-bg)] hover:text-text`
 }
 ${
   // Contextual tab accent (e.g., Table Design)
   isContextual && !isActive ? 'border-t-2 border-t-[var(--tab-contextual-accent)]' : ''
 }
 ${isContextual && isActive ? 'border-t-2 border-t-[var(--tab-contextual-accent)]' : ''}
 `}
            >
              {tab.label}
              {isActive && (
                <span
                  className="absolute left-[var(--tabbar-tab-padding-x)] right-[var(--tabbar-tab-padding-x)] bottom-0 bg-[var(--tab-active-text)]"
                  style={{ height: 'var(--tab-active-underline)' }}
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Collaborate, Save, Print, PDF, Export buttons and command-bar display options */}
      <div
        data-testid="tabbar-command-cluster"
        className="hidden min-[720px]:flex flex-shrink-0 items-center gap-[var(--tabbar-button-group-gap)] ml-auto"
      >
        {collabEnabled && remoteParticipants.size > 0 && (
          <RibbonVisibilityPathItem path={['collaboration', 'tabBar', 'avatars']}>
            <AvatarList participants={remoteParticipants} />
          </RibbonVisibilityPathItem>
        )}
        <CollaborateButton />

        {showPrint && onPrint && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onPrintClick ?? onPrint}
            disabled={isPrinting}
            title="Print (Ctrl+P)"
            aria-label="Print"
          >
            {isPrinting ? <SpinnerIcon /> : <PrintIcon />}
          </Button>
        )}
        {showPrint && onPdfExport && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onPdfExport}
            disabled={isPdfExporting}
            title="Export to PDF"
            aria-label="Export to PDF"
          >
            {isPdfExporting ? <SpinnerIcon /> : <PdfIcon />}
          </Button>
        )}
        {showExport && onExport && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onExport}
            disabled={isExporting}
            title="Export to XLSX (Ctrl+Shift+S)"
            aria-label="Export to XLSX"
          >
            {isExporting ? <SpinnerIcon /> : <DownloadIcon />}
          </Button>
        )}

        {/* Divider */}
        <div className="w-px h-5 bg-ss-border-light mx-1" />

        {/* Command-bar collapse toggle (Ctrl+Shift+F1).
 Always rendered. Carries state-conditional testids:
 `panel-ribbon-close` when expanded, `ribbon-reopen` when
 collapsed. One button,
 one source of truth — `ribbonCollapsed` on the RibbonSlice. */}
        <RibbonCollapseToggle />

        {/* Command-bar display options */}
        <RibbonDisplayOptions />
      </div>
    </div>
  );
}

/**
 * TabBar - memoized to prevent re-renders when parent re-renders.
 *
 * PERFORMANCE: Wrapped with React.memo to prevent unnecessary re-renders.
 * Uses type assertion to maintain generic type parameter support.
 */
export const TabBar = React.memo(TabBarImpl) as typeof TabBarImpl;
