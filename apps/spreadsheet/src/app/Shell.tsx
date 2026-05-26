/**
 * Main Shell Container
 *
 * Top-level component that orchestrates the entire spreadsheet shell UI.
 * Coordinates between views, toolbar, sidebars, and shared dialogs.
 *
 * Architecture:
 * - Shell owns the layout structure (toolbar, views, sidebars)
 * - ViewContainer manages active view rendering
 * - RecordDetailSidebar appears on right when viewing record details
 * - CommandPalette and ViewSwitcher are overlays
 *
 * State management:
 * - activeViewId from ShellUIStore (navigation slice)
 * - Stores accessed via hooks (useShellStore)
 *
 * TODO: Once ShellCoordinator is implemented, get adapter from coordinator
 * and pass it to ViewContainer instead of using ViewContainerById placeholder.
 */

import { CommandPalette } from '../dialogs/navigation/CommandPalette';
import { useShellStore } from '../infra/context';
import { ViewContainerById } from '../views/container';
import type { ViewId } from '../views/types';
import { RecordDetailSidebar } from './RecordDetailSidebar';
import { ViewSwitcher } from './ViewSwitcher';
interface ShellProps {
  /** Initial view ID to display (optional, falls back to first registered view) */
  initialViewId?: string;
}

/**
 * Main Shell component.
 * Renders the complete spreadsheet interface with views, toolbar, and dialogs.
 */
export function Shell({ initialViewId }: ShellProps) {
  const activeViewId = useShellStore((s) => s.activeViewId);

  return (
    <div className="flex flex-col h-full">
      {/* TODO: Add Toolbar */}
      <div className="flex flex-1 overflow-hidden">
        {/* TODO: Use ViewContainer with adapter once coordinator is ready */}
        <ViewContainerById viewId={(activeViewId || initialViewId || '') as ViewId} />
        <RecordDetailSidebar />
      </div>
      {/* Overlay components */}
      <CommandPalette />
      <ViewSwitcher />
    </div>
  );
}
