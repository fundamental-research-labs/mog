/**
 * View Switcher Component
 *
 * Radix Dialog for switching between view types (Grid, Kanban, Timeline, etc.).
 * Appears when user clicks view switcher button or uses keyboard shortcut.
 *
 * Design:
 * - Radix Dialog with focus trap, ARIA dialog role, ESC handling
 * - Lists all registered view types from ViewRegistry
 * - Clicking a view type switches the active view
 * - Managed by viewSwitcherOpen state in NavigationSlice
 *
 * Future enhancements:
 * - View type icons
 * - Keyboard navigation
 * - Recent views list
 * - View creation options
 */

import { Dialog, DialogBody, DialogHeader } from '@mog/shell';

import { useShellStore } from '../infra/context';
import { VIEW_REGISTRY } from '../views/registry';

/**
 * View type switcher dialog.
 * Shows all available view types and handles switching.
 */
export function ViewSwitcher() {
  const viewSwitcherOpen = useShellStore((s) => s.viewSwitcherOpen);
  const closeViewSwitcher = useShellStore((s) => s.closeViewSwitcher);
  const setActiveViewId = useShellStore((s) => s.setActiveViewId);

  const views = VIEW_REGISTRY.list();

  const handleViewSelect = (viewType: string) => {
    // Set the active view ID to the view type
    // For now, viewId === viewType (grid, kanban, etc.)
    // In the future, this will create/select a specific view instance
    setActiveViewId(viewType);
    closeViewSwitcher();
  };

  return (
    <Dialog open={viewSwitcherOpen} onClose={closeViewSwitcher} width="sm">
      <DialogHeader onClose={closeViewSwitcher}>Switch View</DialogHeader>
      <DialogBody noPadding>
        <div className="p-2">
          {views.map((view) => (
            <button
              key={view.type}
              className="block w-full text-left px-3 py-2 hover:bg-ss-surface-hover rounded transition-colors"
              onClick={() => handleViewSelect(view.type)}
            >
              <div className="font-medium">{view.name}</div>
              {view.description && (
                <div className="text-caption text-ss-text-secondary mt-0.5">{view.description}</div>
              )}
            </button>
          ))}
        </div>
      </DialogBody>
    </Dialog>
  );
}
