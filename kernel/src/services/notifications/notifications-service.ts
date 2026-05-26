/**
 * Notifications Service
 *
 * Cross-app toast/notification queue.
 * Manages a queue of notifications that survive app switches.
 *
 */

import type {
  INotificationsService,
  Notification,
  NotificationId,
  NotificationOptions,
  NotificationsState,
  NotificationType,
} from './types';
import { Subscribable } from '../primitives';

// =============================================================================
// Constants
// =============================================================================

/** Default auto-dismiss duration in milliseconds */
const DEFAULT_DURATION = 5000;

/** Default maximum visible notifications */
const DEFAULT_MAX_VISIBLE = 5;

// =============================================================================
// Notifications Service Implementation
// =============================================================================

/**
 * Notifications service implementation.
 * Cross-app toast/notification queue.
 *
 * Extends Subscribable<Notification[]> — subscribe() returns IDisposable,
 * listeners are automatically cleaned up on dispose.
 */
class NotificationsService extends Subscribable<Notification[]> implements INotificationsService {
  private state: NotificationsState;
  private timers = new Map<NotificationId, ReturnType<typeof setTimeout>>();
  private idCounter = 0;

  constructor(maxVisible: number = DEFAULT_MAX_VISIBLE) {
    super();
    this.state = {
      notifications: [],
      maxVisible,
    };
  }

  // ===========================================================================
  // Subscribable<Notification[]>
  // ===========================================================================

  getSnapshot(): Notification[] {
    return this.state.notifications;
  }

  // ===========================================================================
  // State
  // ===========================================================================

  getAll(): Notification[] {
    return this.state.notifications;
  }

  getCount(): number {
    return this.state.notifications.length;
  }

  // ===========================================================================
  // Commands
  // ===========================================================================

  /**
   * Add a notification.
   *
   * NOTE: This method name shadows Subscribable.notify() (protected, no args).
   * We call the base class's listener broadcast via emitChange() instead.
   */
  notify(message: string, options?: NotificationOptions): NotificationId {
    const id = this.generateId();
    const type: NotificationType = options?.type ?? 'info';
    const duration = options?.duration === undefined ? DEFAULT_DURATION : options.duration;

    const notification: Notification = {
      id,
      type,
      message,
      title: options?.title,
      timestamp: Date.now(),
      duration,
      dismissible: options?.dismissible ?? true,
      action: options?.action,
    };

    // Add to the beginning (newest first)
    this.state.notifications = [notification, ...this.state.notifications];

    // Trim to max visible
    if (this.state.notifications.length > this.state.maxVisible) {
      const removed = this.state.notifications.slice(this.state.maxVisible);
      this.state.notifications = this.state.notifications.slice(0, this.state.maxVisible);
      // Clear timers for removed notifications
      for (const n of removed) {
        this.clearTimer(n.id);
      }
    }

    // Set auto-dismiss timer if duration is specified
    if (duration !== null) {
      this.setTimer(id, duration);
    }

    this.emitChange();
    return id;
  }

  info(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId {
    return this.notify(message, { ...options, type: 'info' });
  }

  success(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId {
    return this.notify(message, { ...options, type: 'success' });
  }

  warning(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId {
    return this.notify(message, { ...options, type: 'warning' });
  }

  error(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId {
    // Errors default to no auto-dismiss
    const duration = options?.duration === undefined ? null : options.duration;
    return this.notify(message, { ...options, type: 'error', duration });
  }

  dismiss(id: NotificationId): void {
    const index = this.state.notifications.findIndex((n) => n.id === id);
    if (index === -1) return;

    this.clearTimer(id);
    this.state.notifications = [
      ...this.state.notifications.slice(0, index),
      ...this.state.notifications.slice(index + 1),
    ];
    this.emitChange();
  }

  dismissAll(): void {
    // Clear all timers
    for (const id of this.timers.keys()) {
      this.clearTimer(id);
    }
    this.state.notifications = [];
    this.emitChange();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected _dispose(): void {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.state.notifications = [];
    super._dispose();
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private generateId(): NotificationId;
  private generateId() {
    return `notification-${++this.idCounter}-${Date.now()}`;
  }

  private setTimer(id: NotificationId, duration: number): void {
    const timer = setTimeout(() => {
      this.dismiss(id);
    }, duration);
    this.timers.set(id, timer);
  }

  private clearTimer(id: NotificationId): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  // emitChange() is inherited from Subscribable — call directly in methods above.
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new notifications service instance.
 */
export function createNotificationsService(
  maxVisible: number = DEFAULT_MAX_VISIBLE,
): INotificationsService {
  return new NotificationsService(maxVisible);
}
