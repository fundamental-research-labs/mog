/**
 * ToastRenderer Component
 *
 * Subscribes to the kernel NotificationsService and renders toast notifications.
 * This is the primary UI for displaying cross-app notifications.
 *
 * Features:
 * - Bottom-right positioning (consistent with FontWarningToast)
 * - Different colors for info, success, warning, error types
 * - Dismiss button for dismissible toasts
 * - Vertical stacking for multiple toasts
 * - ARIA live region for accessibility
 *
 * @see kernel/src/services/notifications/
 */

import { memo, useCallback, useEffect, useState } from 'react';

import type { Notification } from '@mog-sdk/contracts/api';

import { useWorkbook } from '../../infra/context';

// =============================================================================
// Type-based Styling
// =============================================================================

/**
 * Get CSS classes for a notification type.
 */
function getTypeStyles(type: Notification['type']): {
  container: string;
  text: string;
  icon: string;
} {
  switch (type) {
    case 'success':
      return {
        container: 'bg-ss-success-light',
        text: 'text-ss-success-dark',
        icon: '\u2713', // Checkmark
      };
    case 'warning':
      return {
        container: 'bg-ss-warning',
        text: 'text-ss-warning-dark',
        icon: '\u26A0', // Warning sign
      };
    case 'error':
      return {
        container: 'bg-ss-error-light',
        text: 'text-ss-error-dark',
        icon: '\u2717', // X mark
      };
    case 'info':
    default:
      return {
        container: 'bg-ss-info-light',
        text: 'text-ss-info-dark',
        icon: '\u2139', // Info symbol
      };
  }
}

// =============================================================================
// Toast Item Component
// =============================================================================

interface ToastItemProps {
  notification: Notification;
  onDismiss: (id: Notification['id']) => void;
}

const ToastItem = memo(function ToastItem({ notification, onDismiss }: ToastItemProps) {
  const { id, type, title, message, dismissible, action } = notification;
  const styles = getTypeStyles(type);

  const handleDismiss = useCallback(() => {
    onDismiss(id);
  }, [id, onDismiss]);

  const handleAction = useCallback(() => {
    action?.onClick();
    // Optionally dismiss after action
    onDismiss(id);
  }, [action, id, onDismiss]);

  return (
    <div
      className={`${styles.container} ${styles.text} px-4 py-3 rounded-ss-lg shadow-ss-md z-ss-toast flex items-start gap-3 max-w-sm animate-slide-up`}
    >
      {/* Icon */}
      <span className={`${styles.text} text-body-lg flex-shrink-0 mt-0.5`} aria-hidden="true">
        {styles.icon}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0" role="alert" aria-live="polite">
        {title && <div className="font-semibold text-body-sm mb-0.5">{title}</div>}
        <div className="text-body-sm">{message}</div>

        {/* Action button */}
        {action && (
          <button
            type="button"
            onClick={handleAction}
            className="mt-2 text-body-sm font-medium underline hover:no-underline"
          >
            {action.label}
          </button>
        )}
      </div>

      {/* Dismiss button */}
      {dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          className={`p-1 rounded hover:bg-ss-surface-hover transition-colors flex-shrink-0`}
          aria-label="Dismiss notification"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="currentColor"
            className={styles.text}
          >
            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L7 6.293l1.646-1.647a.5.5 0 0 1 .708.708L7.707 7l1.647 1.646a.5.5 0 0 1-.708.708L7 7.707l-1.646 1.647a.5.5 0 0 1-.708-.708L6.293 7 4.646 5.354a.5.5 0 0 1 0-.708z" />
          </svg>
        </button>
      )}
    </div>
  );
});

// =============================================================================
// Toast Renderer Component
// =============================================================================

/**
 * ToastRenderer - Renders notifications from the kernel NotificationsService.
 *
 * This component subscribes to the notifications service and renders all active
 * notifications as a vertically stacked list in the bottom-right corner.
 *
 * Usage:
 * ```tsx
 * // Add to your layout alongside other overlays
 * <ToastRenderer />
 * ```
 */
export const ToastRenderer = memo(function ToastRenderer() {
  const wb = useWorkbook();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Get the notifications sub-API from the Workbook
  const notificationsService = wb.notifications;

  // Subscribe to notifications service
  useEffect(() => {
    if (!notificationsService) return;
    return notificationsService.subscribe(setNotifications);
  }, [notificationsService]);

  // Handle dismiss
  const handleDismiss = useCallback(
    (id: Notification['id']) => {
      notificationsService?.dismiss(id);
    },
    [notificationsService],
  );

  // Don't render if no notifications service or no notifications
  if (!notificationsService || notifications.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute bottom-4 right-4 z-ss-toast flex flex-col gap-2"
      aria-label="Notifications"
    >
      {notifications.map((notification) => (
        <ToastItem key={notification.id} notification={notification} onDismiss={handleDismiss} />
      ))}
    </div>
  );
});
