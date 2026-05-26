/**
 * FontWarningToast Component
 *
 * Shows a toast notification when a user selects an unavailable font.
 * The toast auto-dismisses and can also be dismissed manually.
 *
 * Font Unavailability Toast
 */

import { useUIStore } from '../../../infra/context';

/**
 * FontWarningToast - Renders font unavailability toast
 *
 * Shown when user selects a font that is not installed on the system.
 * The selected font will still be applied (using fallback rendering),
 * but this toast informs the user that the font may not display correctly.
 *
 * Features:
 * - Auto-positioned at bottom-right of the grid
 * - Warning styling with orange/amber color scheme
 * - Dismissible via X button
 * - Auto-dismisses after 5 seconds (handled by FontPicker)
 */
export function FontWarningToast() {
  const fontWarningMessage = useUIStore((s) => s.fontWarningMessage);
  const dismissFontWarning = useUIStore((s) => s.dismissFontWarning);

  if (!fontWarningMessage) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="absolute bottom-4 right-4 bg-ss-warning text-ss-warning-dark px-4 py-3 rounded-ss-lg shadow-ss-md z-ss-toast flex items-center gap-3 max-w-sm animate-slide-up"
    >
      <span className="text-ss-warning-dark text-body-lg">&#x26A0;</span>
      <span className="flex-1 text-body-sm">{fontWarningMessage}</span>
      <button
        type="button"
        onClick={dismissFontWarning}
        className="p-1 rounded hover:bg-ss-warning-dark/10 transition-colors"
        aria-label="Dismiss warning"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="currentColor"
          className="text-ss-warning-dark"
        >
          <path d="M4.646 4.646a.5.5 0 0 1 .708 0L7 6.293l1.646-1.647a.5.5 0 0 1 .708.708L7.707 7l1.647 1.646a.5.5 0 0 1-.708.708L7 7.707l-1.646 1.647a.5.5 0 0 1-.708-.708L6.293 7 4.646 5.354a.5.5 0 0 1 0-.708z" />
        </svg>
      </button>
    </div>
  );
}
