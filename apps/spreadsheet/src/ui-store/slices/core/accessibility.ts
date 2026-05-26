/**
 * Accessibility Slice
 *
 * Manages accessibility-related UI state including screen reader announcements.
 * This slice provides a way for action handlers to trigger ARIA live region
 * announcements via the AccessibilityAnnouncer component.
 *
 * Screen Reader Accessibility
 */

import type { StateCreator } from 'zustand';

/**
 * Priority level for accessibility announcements.
 * - polite: Non-urgent information (default)
 * - assertive: Urgent information that should interrupt
 */
export type AnnouncementPriority = 'polite' | 'assertive';

/**
 * Pending accessibility announcement.
 * Set by action handlers, consumed by AccessibilityAnnouncer component.
 */
export interface PendingAnnouncement {
  /** The message to announce */
  message: string;
  /** Priority level for the announcement */
  priority: AnnouncementPriority;
  /** Timestamp to force re-announcement of same message */
  timestamp: number;
}

export interface AccessibilitySlice {
  /**
   * Pending accessibility announcement.
   * When set, the AccessibilityAnnouncer component should announce this message
   * and then clear it.
   */
  pendingAnnouncement: PendingAnnouncement | null;

  /**
   * Queue an announcement to be read by screen readers.
   * The message will be announced via ARIA live regions.
   *
   * @param message - The text to announce
   * @param priority - 'polite' (default) or 'assertive'
   */
  announce: (message: string, priority?: AnnouncementPriority) => void;

  /**
   * Clear the pending announcement.
   * Called by AccessibilityAnnouncer after the message has been announced.
   */
  clearAnnouncement: () => void;
}

export const createAccessibilitySlice: StateCreator<
  AccessibilitySlice,
  [],
  [],
  AccessibilitySlice
> = (set) => ({
  pendingAnnouncement: null,

  announce: (message: string, priority: AnnouncementPriority = 'polite') => {
    set({
      pendingAnnouncement: {
        message,
        priority,
        timestamp: Date.now(),
      },
    });
  },

  clearAnnouncement: () => {
    set({ pendingAnnouncement: null });
  },
});
