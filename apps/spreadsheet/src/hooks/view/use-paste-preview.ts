/**
 * Paste Preview Hook
 *
 * Provides paste preview functionality for the PasteDropdown component.
 * When hovering over a paste option, calculates and displays a preview
 * of what the paste would look like.
 *
 */

import { useCallback, useMemo } from 'react';

import { RenderPriority } from '@mog-sdk/contracts/rendering';

import {
  calculatePastePreview,
  isPastePreviewAvailable,
} from '../../domain/clipboard/paste-preview-calculator';
import { useActiveSheetId, useUIStoreApi } from '../../infra/context';
import type { PasteOption } from '../../ui-store/slices/clipboard/paste-options';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// Types
// =============================================================================

export interface UsePastePreviewReturn {
  /**
   * Show paste preview for a specific option.
   * Call this on mouseEnter of paste dropdown items.
   */
  showPreview: (option: PasteOption) => void;

  /**
   * Hide the paste preview.
   * Call this on mouseLeave of paste dropdown items.
   */
  hidePreview: () => void;

  /**
   * Check if preview is available for an option.
   * Some options (like Paste Special dialog) don't support preview.
   */
  isPreviewAvailable: (option: PasteOption) => boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for paste preview functionality.
 *
 * Usage in PasteDropdown:
 * ```tsx
 * const { showPreview, hidePreview, isPreviewAvailable } = usePastePreview();
 *
 * <RibbonDropdownItem
 * onMouseEnter={ => showPreview('valuesOnly')}
 * onMouseLeave={hidePreview}
 * >
 * Paste Values
 * </RibbonDropdownItem>
 * ```
 */
export function usePastePreview(): UsePastePreviewReturn {
  const coordinator = useCoordinator();
  const clipboardActor = coordinator.grid.access.actors.clipboard;
  const rendererActor = coordinator.renderer.access.actors.renderer;
  // PERFORMANCE FIX: Removed useActiveCell() subscription - was causing re-renders on every cell click
  // activeCell is only needed inside showPreview callback, so read on-demand instead
  // @see docs/ARCHITECTURE-CHECKLIST.md - Section 18: Handlers use point-in-time reads
  const sheetId = useActiveSheetId();

  // Get UI store actions for paste preview
  const uiStoreApi = useUIStoreApi();

  const showPreview = useCallback(
    (option: PasteOption) => {
      // Check if preview is available for this option
      if (!isPastePreviewAvailable(option)) {
        return;
      }

      // Get clipboard data from XState machine
      const clipboardState = clipboardActor.getSnapshot();
      const clipboardData = clipboardState.context.data;

      if (!clipboardData) {
        // No clipboard data - nothing to preview
        return;
      }

      // PERFORMANCE: Read activeCell on-demand when action fires (not via subscription)
      const targetCell = coordinator.grid.getSelectionSnapshot().activeCell;

      // Calculate preview
      const previewResult = calculatePastePreview(clipboardData, targetCell, sheetId, option);

      // Show preview in UI store (which will propagate to selection layer)
      uiStoreApi
        .getState()
        .showPastePreview(option, sheetId, previewResult.targetRange, previewResult.cells);

      // Invalidate to trigger re-render with preview
      rendererActor.send({ type: 'INVALIDATE', priority: RenderPriority.USER_BLOCKING });
    },
    [clipboardActor, coordinator, sheetId, uiStoreApi, rendererActor],
  );

  const hidePreview = useCallback(() => {
    uiStoreApi.getState().hidePastePreview();

    // Invalidate to clear preview
    rendererActor.send({ type: 'INVALIDATE', priority: RenderPriority.USER_BLOCKING });
  }, [uiStoreApi, rendererActor]);

  const isPreviewAvailable = useCallback(
    (option: PasteOption) => {
      // Check if clipboard has data
      const clipboardState = clipboardActor.getSnapshot();
      const hasData = !!clipboardState.context.data;

      // Check if this option supports preview
      return hasData && isPastePreviewAvailable(option);
    },
    [clipboardActor],
  );

  return useMemo(
    () => ({
      showPreview,
      hidePreview,
      isPreviewAvailable,
    }),
    [showPreview, hidePreview, isPreviewAvailable],
  );
}
