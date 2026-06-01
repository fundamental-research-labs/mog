/**
 * BackstageNav Component
 *
 * Left navigation menu for the backstage view.
 * Shows a back button and list of available panels.
 *
 * ARCHITECTURE: Uses dispatch() from Unified Action System for all user
 * interactions. Each row is either a *panel link* that switches the active
 * backstage panel, or an *action item* that fires a dispatched action
 * directly. The discriminated union (NavPanelItem | NavActionItem) is kept
 * so future Excel-parity tweaks can flip an item between kinds without a
 * shape change. The harness reaches sub-panel leaves (e.g. Export's
 * `file-menu-item-export-{csv,pdf,xlsx}`) via the standard navigate-then-
 * click path: open the panel via `clickFileMenuItem(page, 'export')`, then
 * click the panel button. This matches BrowseFilesPanel and avoids distorting
 * production with action-kind shortcuts purely for tests.
 *
 */

import { useCallback } from 'react';
import { dispatch, useActionDependencies } from '../../../internal-api';
import type { BackstagePanelType } from '../../../ui-store/types';

export interface BackstageNavProps {
  activePanel: BackstagePanelType;
  onClose: () => void;
}

/**
 * Discriminated union: each nav row is either a panel link (switches the
 * active backstage panel) or an action item (dispatches a typed action).
 * No action items are currently mounted — Browse Files and Export both
 * navigate to a sub-panel where the leaf affordance lives. The union is
 * retained so a future Excel-parity follow-up can flip a row to action-kind
 * (e.g. one-click Browse Files on desktop) without a shape change.
 */
type NavPanelItem = {
  kind: 'panel';
  id: BackstagePanelType;
  label: string;
  /** When true, render under the previous panel link as a sub-item. */
  indent?: boolean;
};

type NavActionItem = {
  kind: 'action';
  /** Stable testid suffix — `file-menu-item-${id}`. */
  id: string;
  label: string;
  action: 'BROWSE_FILES' | 'CLOSE_BACKSTAGE';
  indent?: boolean;
};

type NavItem = NavPanelItem | NavActionItem;

const NAV_ITEMS: NavItem[] = [
  { kind: 'panel', id: 'info', label: 'Info' },
  { kind: 'panel', id: 'new', label: 'New' },
  { kind: 'panel', id: 'open', label: 'Open' },
  // browse-files renders a sub-panel (BrowseFilesPanel) carrying the
  // `file-menu-item-browse-action` button which dispatches BROWSE_FILES.
  // The two-step path (nav → panel button) lets the chrome-symmetry harness
  // assert the leaf separately from the trigger, matching the upstream
  // file-menu sub-panel contract.
  { kind: 'panel', id: 'browse-files', label: 'Browse Files' },
  { kind: 'panel', id: 'recents', label: 'Recents' },
  { kind: 'panel', id: 'save', label: 'Save' },
  { kind: 'panel', id: 'save-as', label: 'Save As' },
  { kind: 'panel', id: 'print', label: 'Print' },
  { kind: 'panel', id: 'share', label: 'Share' },
  { kind: 'panel', id: 'export', label: 'Export' },
  // Export sub-items live on ExportPanel itself (data-testid
  // `file-menu-item-export-{csv,pdf,xlsx}` on the panel buttons). Tests use
  // the navigate-then-click path: clickFileMenuItem(page, 'export') opens
  // the panel, then click the leaf button. One owner per testid, production
  // shape unchanged by tests. Same pattern as BrowseFilesPanel.
  //
  // Close dismisses the backstage and returns focus to the grid. It is the
  // only nav row that has no panel of its own — there is no preference to
  // confirm before dismissing — so it dispatches CLOSE_BACKSTAGE directly.
  { kind: 'action', id: 'close', label: 'Close', action: 'CLOSE_BACKSTAGE' },
];

export function BackstageNav({ activePanel, onClose }: BackstageNavProps) {
  const deps = useActionDependencies();

  const handlePanelClick = useCallback(
    (panelId: BackstagePanelType) => {
      // Use dispatch() from Unified Action System (architecture requirement)
      dispatch('SET_BACKSTAGE_PANEL', deps, { panel: panelId });
    },
    [deps],
  );

  const handleActionClick = useCallback(
    (action: NavActionItem['action']) => {
      dispatch(action, deps);
    },
    [deps],
  );

  return (
    <div className="w-[240px] bg-ss-surface-secondary border-r border-ss-border flex flex-col">
      {/* Back button */}
      <button
        type="button"
        data-testid="backstage-back"
        onClick={onClose}
        className="flex items-center gap-2 px-4 py-3 text-body text-text whitespace-nowrap hover:bg-ss-surface-hover transition-colors"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="text-current"
        >
          <path
            d="M10 12L6 8L10 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Back to spreadsheet</span>
      </button>

      {/* Navigation items */}
      <nav className="flex-1 py-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.kind === 'panel' && item.id === activePanel;
          const indentCls = item.indent ? 'pl-10 pr-6' : 'px-6';
          return (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              data-testid={`file-menu-item-${item.id}`}
              onClick={() =>
                item.kind === 'panel' ? handlePanelClick(item.id) : handleActionClick(item.action)
              }
              className={`
 w-full ${indentCls} py-3 text-left text-body whitespace-nowrap
 transition-colors
 ${
   isActive
     ? 'bg-ss-primary-light text-ss-primary font-medium'
     : 'text-ss-text-secondary hover:bg-ss-surface-hover hover:text-text'
 }
 `}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
