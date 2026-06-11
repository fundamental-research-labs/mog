/**
 * Scroll-Commit Coordination
 *
 * When the user scrolls the grid while the inline cell editor is open,
 * commit the edit and close the editor — matching Excel behavior.
 *
 * Pattern: Subscribes to editor state to cache editing status, then
 * listens for scroll changes and commits if actively editing.
 *
 * @see comment-hover-coordination.ts — same onScrollChange subscription pattern
 * @see cross-coordination.ts — COMMIT on click-outside uses same approach
 */

import type { EditorActor } from '../../shared/actor-types';

// =============================================================================
// Types
// =============================================================================

export interface ScrollCommitCoordinationConfig {
  /** The editor XState actor to subscribe to and send COMMIT */
  editorActor: EditorActor;
  /** Subscribe to scroll changes; returns unsubscribe function */
  onScrollChange: (callback: () => void) => () => void;
}

export interface ScrollCommitCoordinationResult {
  /** Cleanup function to unsubscribe from scroll and editor state */
  cleanup: () => void;
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Set up scroll-commit coordination.
 *
 * When the grid scrolls while a regular editor is active, commit the current
 * edit with direction 'none' (no cursor movement). Formula point-mode edits
 * stay open because sheet switches restore scroll position while the user is
 * building cross-sheet references.
 *
 * Uses a cached subscription to editor state instead of polling getSnapshot().
 *
 * Edge cases handled:
 * - IME composing: top-level state, excluded by the isEditing check
 * - Validating/committing: already in commit pipeline, excluded by isEditing check
 *
 * @param config - Configuration with editor actor and scroll subscription
 * @returns Result object with cleanup function
 */
export function setupScrollCommitCoordination(
  config: ScrollCommitCoordinationConfig,
): ScrollCommitCoordinationResult {
  const { editorActor, onScrollChange } = config;

  // M6 fix: Cache editing state via subscription instead of polling getSnapshot()
  let shouldCommitOnScroll = false;
  const editorSubscription = editorActor.subscribe((state) => {
    shouldCommitOnScroll = state.matches('editing') || state.matches('richTextEditing');
  });

  const handleScroll = (): void => {
    // Only commit if actively editing text or rich text.
    // Formula point-mode is excluded because cross-sheet navigation restores
    // scroll and must not validate/commit an incomplete formula.
    // imeComposing, validating, committing, inactive, etc. are all excluded.
    if (!shouldCommitOnScroll) return;

    editorActor.send({ type: 'COMMIT', direction: 'none' });
  };

  const unsubscribeScroll = onScrollChange(handleScroll);

  // L6 fix: Ensure all subscriptions are cleaned up on every exit path
  let disposed = false;
  return {
    cleanup: () => {
      if (disposed) return;
      disposed = true;
      editorSubscription.unsubscribe();
      unsubscribeScroll();
    },
  };
}
