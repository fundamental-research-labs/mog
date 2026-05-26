/**
 * SchemaBrowserContainer
 *
 * Container component that orchestrates schema browser panel state.
 * Follows the render isolation pattern - ONLY subscribes to schemaBrowser.isOpen.
 *
 * This container:
 * - Conditionally renders SchemaBrowser when panel is open
 * - Provides positioning wrapper for the side panel
 * - Uses minimal state subscription to prevent unnecessary re-renders
 *
 * Architecture requirements (from ARCHITECTURE-CHECKLIST.md):
 * - Container ONLY subscribes to schema browser isOpen state
 * - The panel component itself subscribes to other schema browser state
 */

import { useUIStore } from '../../infra/context';
import { SchemaBrowser } from './SchemaBrowser';

// =============================================================================
// Types
// =============================================================================

export interface SchemaBrowserContainerProps {
  /**
   * Optional custom class name for the panel wrapper.
   */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Container component that manages schema browser panel visibility.
 * Renders SchemaBrowser when the panel is open.
 *
 * RENDER ISOLATION: Only subscribes to schemaBrowser.isOpen to prevent
 * re-renders when other schema browser state changes (schema data, loading, etc.)
 */
export function SchemaBrowserContainer({
  className,
}: SchemaBrowserContainerProps): React.JSX.Element | null {
  // ONLY subscribe to isOpen state for render isolation
  const isOpen = useUIStore((s) => s.schemaBrowser?.isOpen ?? false);

  // Only render when panel is open
  if (!isOpen) {
    return null;
  }

  return (
    <div className={className ?? 'absolute top-0 right-0 bottom-0 z-ss-sticky'}>
      <SchemaBrowser />
    </div>
  );
}
