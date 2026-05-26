/**
 * WorkbookNotificationsImpl -- Notifications sub-API implementation.
 *
 * Thin wrapper delegating to INotificationsService from kernel services.
 */
import type { CallableDisposable } from '@mog/spreadsheet-utils/disposable';
import type { NotificationId, WorkbookNotifications } from '@mog-sdk/contracts/api';
import type {
  INotificationsService,
  Notification,
  NotificationOptions,
} from '@mog-sdk/contracts/services';

export class WorkbookNotificationsImpl implements WorkbookNotifications {
  private readonly svc: INotificationsService;

  constructor(notificationsService: INotificationsService) {
    this.svc = notificationsService;
  }

  getAll(): Notification[] {
    return this.svc.getAll();
  }

  subscribe(listener: (notifications: Notification[]) => void): CallableDisposable {
    return this.svc.subscribe(listener);
  }

  notify(message: string, options?: NotificationOptions): NotificationId {
    return this.svc.notify(message, options);
  }

  info(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId {
    return this.svc.info(message, options);
  }

  success(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId {
    return this.svc.success(message, options);
  }

  warning(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId {
    return this.svc.warning(message, options);
  }

  error(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId {
    return this.svc.error(message, options);
  }

  dismiss(id: NotificationId): void {
    this.svc.dismiss(id);
  }

  dismissAll(): void {
    this.svc.dismissAll();
  }
}
