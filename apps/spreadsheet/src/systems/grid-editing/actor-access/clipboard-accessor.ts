/**
 * Clipboard Actor Access Implementation
 *
 * Implements ClipboardAccessor using selectors.
 * THIS IS THE ONLY PLACE that calls actor.getSnapshot() for handlers.
 *
 * @module engine/state/coordinator/actor-access/clipboard
 */

import { clipboardSelectors } from '../../../selectors';
import type { ClipboardAccessor, ClipboardState } from '@mog-sdk/contracts/actors';

/**
 * Minimal actor interface for clipboard accessor.
 * Uses getSnapshot() to capture point-in-time state.
 */
type ClipboardActor = { getSnapshot(): ClipboardState };

/**
 * Creates a ClipboardAccessor for point-in-time reads in handlers.
 *
 * Each method delegates to the corresponding selector with a fresh snapshot.
 * This ensures handlers always get current state at the moment of call.
 *
 * @param actor - The XState clipboard actor
 * @returns ClipboardAccessor interface for handlers
 */
export function createClipboardAccessor(actor: ClipboardActor): ClipboardAccessor {
  const snap = () => actor.getSnapshot();

  return {
    // ===========================================================================
    // Value Accessors (match value selectors)
    // ===========================================================================

    getSourceRanges: () => clipboardSelectors.sourceRanges(snap()),
    getData: () => clipboardSelectors.data(snap()),
    getIsCut: () => clipboardSelectors.isCut(snap()),
    getPastePreviewTarget: () => clipboardSelectors.pastePreviewTarget(snap()),
    getMarchingAntsPhase: () => clipboardSelectors.marchingAntsPhase(snap()),
    getErrorMessage: () => clipboardSelectors.errorMessage(snap()),
    getPasteOptions: () => clipboardSelectors.pasteOptions(snap()),
    getSkipSizeCheck: () => clipboardSelectors.skipSizeCheck(snap()),
    getIsStale: () => clipboardSelectors.isStale(snap()),

    // ===========================================================================
    // Derived Value Accessors
    // ===========================================================================

    hasData: () => clipboardSelectors.hasData(snap()),

    // ===========================================================================
    // State Matching Accessors (match state selectors)
    // ===========================================================================

    isEmpty: () => clipboardSelectors.isEmpty(snap()),
    hasCopy: () => clipboardSelectors.hasCopy(snap()),
    hasCut: () => clipboardSelectors.hasCut(snap()),
    isPastePreview: () => clipboardSelectors.isPastePreview(snap()),
    isPasting: () => clipboardSelectors.isPasting(snap()),

    // ===========================================================================
    // Derived Accessors for Snapshot
    // ===========================================================================

    hasCopyAvailable: () => clipboardSelectors.hasCopyAvailable(snap()),
    isExternalClipboard: () => clipboardSelectors.isExternalClipboard(snap()),
    getCutSource: () => clipboardSelectors.cutSource(snap()),
    getCopySource: () => clipboardSelectors.copySource(snap()),
    getSourceSheetId: () => clipboardSelectors.sourceSheetId(snap()),

    hasMarchingAnts: (activeSheetId: string) =>
      clipboardSelectors.hasMarchingAnts(snap(), activeSheetId),

    // ===========================================================================
    // Raw State Access (for unifiedPaste integration)
    // ===========================================================================

    getSnapshot: () => snap(),
  };
}
