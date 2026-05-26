/**
 * Notifications Service Types
 *
 * Types for the kernel notifications service.
 * This is the cross-app toast/notification queue.
 *
 */

import type { CallableDisposable } from '@mog/spreadsheet-utils/disposable';
import type { NotificationId } from '@mog-sdk/contracts/services';

export type { NotificationId } from '@mog-sdk/contracts/services';

// =============================================================================
// Notification Types
// =============================================================================

/**
 * Notification severity levels.
 */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

/**
 * A single notification.
 */
export interface Notification {
  /** Unique ID for the notification */
  id: NotificationId;
  /** Notification type/severity */
  type: NotificationType;
  /** Short title (optional) */
  title?: string;
  /** Main message content */
  message: string;
  /** Timestamp when created */
  timestamp: number;
  /** Auto-dismiss after this many ms (null = manual dismiss only) */
  duration: number | null;
  /** Whether the notification can be dismissed */
  dismissible: boolean;
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Options for creating a notification.
 */
export interface NotificationOptions {
  /** Notification type/severity (default: 'info') */
  type?: NotificationType;
  /** Short title */
  title?: string;
  /** Auto-dismiss duration in ms (default: 5000, null for no auto-dismiss) */
  duration?: number | null;
  /** Whether dismissible (default: true) */
  dismissible?: boolean;
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
  };
}

// =============================================================================
// Service State
// =============================================================================

/**
 * Notifications service state.
 */
export interface NotificationsState {
  /** Current active notifications (ordered by timestamp, newest first) */
  notifications: Notification[];
  /** Maximum number of notifications to show at once */
  maxVisible: number;
}

// =============================================================================
// Service Interface
// =============================================================================

/**
 * Notifications service interface.
 * Cross-app notification/toast queue.
 */
export interface INotificationsService {
  // ===========================================================================
  // State
  // ===========================================================================

  /** Get all active notifications */
  getAll(): Notification[];

  /** Get notification count */
  getCount(): number;

  // ===========================================================================
  // Commands
  // ===========================================================================

  /**
   * Add a notification.
   * @param message - The message to display
   * @param options - Optional configuration
   * @returns The notification ID
   */
  notify(message: string, options?: NotificationOptions): NotificationId;

  /** Convenience: Show info notification */
  info(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;

  /** Convenience: Show success notification */
  success(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;

  /** Convenience: Show warning notification */
  warning(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;

  /** Convenience: Show error notification */
  error(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;

  /** Dismiss a specific notification */
  dismiss(id: NotificationId): void;

  /** Dismiss all notifications */
  dismissAll(): void;

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /** Subscribe to notifications changes. Returns CallableDisposable — call directly or .dispose() to unsubscribe. */
  subscribe(listener: (notifications: Notification[]) => void): CallableDisposable;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Cleanup resources */
  dispose(): void;
}
