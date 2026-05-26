/**
 * Notifications Service Module
 *
 * Cross-app toast/notification queue.
 *
 */

export { createNotificationsService } from './notifications-service';

export type {
  INotificationsService,
  Notification,
  NotificationOptions,
  NotificationType,
  NotificationsState,
} from './types';
