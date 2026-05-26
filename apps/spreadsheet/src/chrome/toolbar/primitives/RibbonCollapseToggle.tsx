/**
 * RibbonCollapseToggle - Always-visible chevron in the tab bar that toggles
 * command-bar collapse (the Ctrl+Shift+F1 state).
 *
 * Interaction rationale:
 * The app exposes a small chevron at the right edge of the tab bar
 * that flips the command bar between "collapsed" and "shown" states. When the
 * command body is collapsed (no commands rendered), this chevron is the
 * user's persistent reopen affordance — keyboard users have Ctrl+Shift+F1,
 * pointer users have this button.
 *
 * The auto-hide trigger strip (`AutoHideRibbonTrigger`) is a *separate*
 * affordance for the orthogonal `displayMode === 'auto-hide'` setting; it
 * does not render when `ribbonCollapsed` is true. Without this toggle,
 * collapsing the command bar via Ctrl+Shift+F1 leaves no visible reopen path.
 *
 * Test contract:
 * Always renders (so the chevron is reachable in either state). The
 * chevron implements the chrome-symmetry `panel-<id>` contract for the
 * ribbon panel:
 * - `data-testid="ribbon-reopen"` when collapsed — the reopen
 * affordance the closed-state contract scans for.
 * - `data-testid="panel-ribbon-close"` when expanded — completes the
 * chrome-symmetry `panel-<id>-close` contract every other panel
 * already follows.
 * - `data-action="open-panel-ribbon"` when collapsed — fallback
 * handle that `findReopenAffordance` consults after the testid.
 * - `data-action="toggle-ribbon"` when expanded — debug-only handle.
 * `data-action` is purely a debug/test handle here; the production
 * click handler dispatches `TOGGLE_RIBBON` directly via `onClick`, not
 * via a data-action lookup, so swapping the attribute by state is safe.
 */

import React, { useCallback } from 'react';
import { useStore } from 'zustand';
import { dispatch, useDocumentContext } from '../../../internal-api';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { ChevronDownIcon, ChevronUpIcon } from './ToolbarIcons';

export interface RibbonCollapseToggleProps {
  /** Additional class names */
  className?: string;
}

export const RibbonCollapseToggle = React.memo(function RibbonCollapseToggle({
  className = '',
}: RibbonCollapseToggleProps) {
  const deps = useActionDependencies();
  const { uiStore } = useDocumentContext();
  const ribbonCollapsed = useStore(uiStore, (s) => s.ribbonCollapsed);

  const handleClick = useCallback(() => {
    dispatch('TOGGLE_RIBBON', deps);
  }, [deps]);

  const label = ribbonCollapsed ? 'Show command bar' : 'Hide command bar';

  // testid is state-conditional so chrome-symmetry tests find the right
  // affordance for either direction of the toggle:
  // - collapsed → 'ribbon-reopen' (existing reopen-affordance contract)
  // - expanded → 'panel-ribbon-close' (panel-<id>-close contract)
  const testId = ribbonCollapsed ? 'ribbon-reopen' : 'panel-ribbon-close';

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`
 flex items-center justify-center
 w-[var(--quick-access-button-size)] h-[var(--quick-access-button-size)] rounded
 bg-transparent hover:bg-ss-surface-hover
 transition-colors duration-ss-fast
 focus:outline-none focus-visible:ring-2 focus-visible:ring-ss-primary
 ${className}
 `}
      title={`${label} (Ctrl+Shift+F1)`}
      aria-label={label}
      aria-pressed={!ribbonCollapsed}
      data-testid={testId}
      data-action={ribbonCollapsed ? 'open-panel-ribbon' : 'toggle-ribbon'}
    >
      {ribbonCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
    </button>
  );
});
