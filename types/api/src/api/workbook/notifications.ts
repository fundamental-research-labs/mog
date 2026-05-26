/**
 * WorkbookNotifications — Sub-API for workbook notifications/toasts.
 *
 * Exposes the kernel NotificationsService through the Workbook interface,
 * so apps import from contracts instead of reaching into kernel internals.
 */
import type { CallableDisposable } from '@mog/types-core/disposable';
import type { Notification, NotificationId, NotificationOptions } from '../../services/index';

export type { NotificationId };

/**
 * Workbook-level notifications sub-API.
 *
 * Provides toast/notification operations without requiring apps to import
 * from `@mog-sdk/kernel/services/notifications`.
 */
export interface WorkbookNotifications {
  /** Get all active notifications */
  getAll(): Notification[];

  /** Subscribe to notification changes. Returns CallableDisposable — call directly or .dispose() to unsubscribe. */
  subscribe(listener: (notifications: Notification[]) => void): CallableDisposable;

  /** Show a notification. Returns the notification ID. */
  notify(message: string, options?: NotificationOptions): NotificationId;

  /** Show an info notification. Returns the notification ID. */
  info(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;

  /** Show a success notification. Returns the notification ID. */
  success(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;

  /** Show a warning notification. Returns the notification ID. */
  warning(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;

  /** Show an error notification. Returns the notification ID. */
  error(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;

  /** Dismiss a notification by ID */
  dismiss(id: NotificationId): void;

  /** Dismiss all notifications */
  dismissAll(): void;
}
