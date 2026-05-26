/**
 * AccessibilityCheckerPanelContainer
 *
 * Container component that orchestrates accessibility checker panel state.
 * Follows the render isolation pattern - ONLY subscribes to accessibilityPanel.isOpen.
 *
 * This container:
 * - Conditionally renders AccessibilityCheckerPanel when panel is open
 * - Provides positioning wrapper for the side panel
 * - Uses minimal state subscription to prevent unnecessary re-renders
 *
 * Architecture requirements (from ARCHITECTURE-CHECKLIST.md):
 * - Container ONLY subscribes to accessibilityPanel slice state
 * - All user interactions use dispatch()
 * - Never calls UIStore actions directly from components
 *
 */

import { useUIStore } from '../../infra/context';
import { AccessibilityCheckerPanel } from './AccessibilityCheckerPanel';

// =============================================================================
// Types
// =============================================================================

export interface AccessibilityCheckerPanelContainerProps {
  /**
   * Optional custom class name for the panel wrapper.
   */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Container component that manages accessibility checker panel visibility.
 * Renders AccessibilityCheckerPanel when the panel is open.
 *
 * RENDER ISOLATION: Only subscribes to accessibilityPanel.isOpen to prevent
 * re-renders when other accessibilityPanel state changes (issues, selectedIssueId, etc.)
 */
export function AccessibilityCheckerPanelContainer({
  className,
}: AccessibilityCheckerPanelContainerProps): React.JSX.Element | null {
  // ONLY subscribe to isOpen state for render isolation
  // The panel component itself subscribes to other accessibilityChecker state
  const isOpen = useUIStore((s) => s.accessibilityChecker?.isOpen ?? false);

  // Only render when panel is open
  if (!isOpen) {
    return null;
  }

  return (
    <div className={className ?? 'absolute top-0 right-0 bottom-0 z-ss-sticky'}>
      <AccessibilityCheckerPanel />
    </div>
  );
}
