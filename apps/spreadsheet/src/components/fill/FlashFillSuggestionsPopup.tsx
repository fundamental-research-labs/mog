/**
 * FlashFillSuggestionsPopup Component
 *
 * Floating popup that appears when Flash Fill detects a pattern.
 * Shows the pattern description and allows user to accept or reject.
 *
 * ARCHITECTURE:
 * - Renders as floating popup near the Flash Fill preview cells
 * - Uses dispatch() for all actions (Unified Action System)
 * - Click handlers (Accept / Dismiss buttons) live here. Keyboard handling
 * (Enter/Tab → ACCEPT_FLASH_FILL, Escape → REJECT_FLASH_FILL) is owned by
 * the unified KeyboardCoordinator via the `'flashFillPreview'` shortcut
 * context — this component does NOT register a document-level keydown
 * listener (a previous implementation did, and it raced the cell editor
 * for Enter, silently swallowing in-flight edits).
 */

import { useCallback, useEffect, useRef } from 'react';

import type { ActionType } from '@mog-sdk/contracts/actions';
import { dispatch } from '../../actions';
import { useCoordinator } from '../../hooks/shared/use-coordinator';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useActiveSheetId, useUIStore } from '../../infra/context';

// =============================================================================
// Component
// =============================================================================

/**
 * FlashFillSuggestionsPopup - Shows pattern detection results
 *
 * Appears when:
 * - User types a value that matches a pattern from adjacent columns
 * - Flash Fill coordinator detects sufficient confidence
 *
 * Actions:
 * - Accept: Apply the preview values (Enter/Tab or click Accept)
 * - Reject: Dismiss the preview (Escape or click X)
 */
export function FlashFillSuggestionsPopup() {
  const deps = useActionDependencies();
  const activeSheetId = useActiveSheetId();
  const coordinator = useCoordinator();
  const popupRef = useRef<HTMLDivElement>(null);

  // Get Flash Fill preview state from UIStore
  const flashFillPreview = useUIStore((s) => s.flashFillPreview);
  const hideFlashFillPreview = useUIStore((s) => s.hideFlashFillPreview);

  // Calculate popup position based on preview range
  const getPopupPosition = useCallback(() => {
    if (!flashFillPreview.isShowingPreview || flashFillPreview.targetColumn === null) {
      return null;
    }

    const geometry = coordinator.renderer.getGeometry();
    if (!geometry) return null;

    // Position popup at the bottom of the target column's preview range
    const endRow = flashFillPreview.endRow ?? 0;
    const targetCol = flashFillPreview.targetColumn;

    // Use geometry capability for page-coord positioning.
    const cellRect = geometry.getCellPageRect({ row: endRow, col: targetCol });
    if (!cellRect) return null; // Cell not visible

    // Position at bottom-right of the preview range
    const x = cellRect.x + cellRect.width + 4;
    const y = cellRect.y + cellRect.height + 4;

    return { x, y };
  }, [flashFillPreview, coordinator]);

  // Handle accept action
  const handleAccept = useCallback(() => {
    dispatch('ACCEPT_FLASH_FILL' as ActionType, deps);
  }, [deps]);

  // Handle reject action
  const handleReject = useCallback(() => {
    dispatch('REJECT_FLASH_FILL' as ActionType, deps);
  }, [deps]);

  // Hide when sheet changes
  useEffect(() => {
    if (flashFillPreview.isShowingPreview && flashFillPreview.sheetId !== activeSheetId) {
      hideFlashFillPreview();
    }
  }, [
    activeSheetId,
    flashFillPreview.isShowingPreview,
    flashFillPreview.sheetId,
    hideFlashFillPreview,
  ]);

  // Don't render if not showing preview
  if (!flashFillPreview.isShowingPreview) {
    return null;
  }

  const position = getPopupPosition();
  if (!position) {
    return null;
  }

  const previewCount = flashFillPreview.previewValues.length;
  const confidence = Math.round((flashFillPreview.confidence ?? 0) * 100);

  return (
    <div
      ref={popupRef}
      className="fixed z-ss-popover bg-ss-surface border border-ss-border rounded-ss-lg shadow-ss-lg"
      style={{
        left: position.x,
        top: position.y,
        maxWidth: 280,
        minWidth: 200,
        // Popup is informational; clicks on its non-button surface must pass
        // through to the cells underneath. Buttons re-enable pointer events
        // individually below. Without this, clicking a cell that the popup
        // visually overlaps registers on the popup chrome instead — selection
        // never updates, dismiss-on-selection-move never fires, and the
        // popup becomes a sticky obstacle.
        pointerEvents: 'none',
      }}
      role="dialog"
      aria-label="Flash Fill Suggestion"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ss-border bg-ss-surface-secondary rounded-t-lg">
        <div className="flex items-center gap-2">
          {/* Flash Fill icon */}
          <svg
            className="w-4 h-4 text-ss-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          <span className="text-body-sm font-medium text-ss-text-secondary">Flash Fill</span>
        </div>
        <button
          onClick={handleReject}
          className="p-1 text-ss-text-disabled hover:text-ss-text-secondary hover:bg-ss-surface-hover rounded"
          style={{ pointerEvents: 'auto' }}
          title="Dismiss (Escape)"
          aria-label="Dismiss Flash Fill suggestion"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        {/* Pattern description */}
        {flashFillPreview.patternDescription && (
          <p className="text-body-sm text-ss-text-secondary mb-2">
            {flashFillPreview.patternDescription}
          </p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-caption text-ss-text-tertiary mb-3">
          <span>
            {previewCount} cell{previewCount !== 1 ? 's' : ''} to fill
          </span>
          {confidence > 0 && (
            <span className="flex items-center gap-1">
              <span
                className={`w-2 h-2 rounded-full ${
                  confidence >= 90
                    ? 'bg-ss-success'
                    : confidence >= 70
                      ? 'bg-ss-warning'
                      : 'bg-ss-warning'
                }`}
              />
              {confidence}% match
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleAccept}
            className="flex-1 px-3 py-1.5 text-body-sm font-medium text-ss-text-inverse bg-ss-primary hover:bg-ss-primary-hover rounded focus:outline-none focus:ring-2 focus:ring-ss-border-focus focus:ring-offset-1"
            style={{ pointerEvents: 'auto' }}
            title="Accept (Enter)"
          >
            Accept
          </button>
          <button
            onClick={handleReject}
            className="flex-1 px-3 py-1.5 text-body-sm font-medium text-ss-text-secondary bg-ss-surface-hover hover:bg-ss-surface-hover rounded focus:outline-none focus:ring-2 focus:ring-ss-border focus:ring-offset-1"
            style={{ pointerEvents: 'auto' }}
            title="Dismiss (Escape)"
          >
            Dismiss
          </button>
        </div>

        {/* Keyboard hints */}
        <p className="mt-2 text-caption text-ss-text-disabled text-center">
          Press{' '}
          <kbd className="px-1 py-0.5 bg-ss-surface-hover rounded text-ss-text-tertiary">Enter</kbd>{' '}
          to accept or{' '}
          <kbd className="px-1 py-0.5 bg-ss-surface-hover rounded text-ss-text-tertiary">Esc</kbd>{' '}
          to dismiss
        </p>
      </div>
    </div>
  );
}

export default FlashFillSuggestionsPopup;
