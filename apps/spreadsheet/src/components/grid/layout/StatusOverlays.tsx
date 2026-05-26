/**
 * StatusOverlays Component
 *
 * Renders error and loading state overlays for the spreadsheet grid.
 * These overlays appear centered on the grid to indicate renderer status.
 *
 * States:
 * - Error: Shows when renderer encounters an error with retry button
 * - Loading: Shows during initial mount and renderer initialization
 *
 * Performance: Uses granular hooks (useRendererStatus, useRendererActions) instead
 * of the full useRenderer() hook to minimize re-renders.
 *
 */

import { useRendererActions, useRendererStatus } from '../../../hooks';
import { Button } from '@mog/shell/components/ui';

/**
 * StatusOverlays - Renders loading and error state overlays
 *
 * Error State:
 * - Shown when hasError is true
 * - Displays error message with retry button
 * - Positioned center of screen with high z-index
 *
 * Loading State:
 * - Shown during unmounted, waitingForLayout, or initializing states
 * - Simple "Loading..." text centered on screen
 */
export function StatusOverlays() {
  // Use granular hooks for better performance
  const { status, hasError } = useRendererStatus();
  const { retry } = useRendererActions();

  return (
    <>
      {/* Error indicator */}
      {hasError && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-ss-error/90 text-ss-text-inverse px-6 py-4 rounded-ss-lg z-ss-toast flex items-center gap-3">
          <span>Renderer error.</span>
          <Button variant="secondary" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {/* Loading state */}
      {(status === 'unmounted' || status === 'waitingForLayout' || status === 'initializing') && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-ss-text-secondary text-body-lg">
          Loading...
        </div>
      )}
    </>
  );
}
