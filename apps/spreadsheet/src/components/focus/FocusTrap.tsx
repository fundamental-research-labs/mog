/**
 * FocusTrap Component
 *
 * A wrapper component that manages focus containment for dialogs, command palettes,
 * context menus, and other overlay components.
 *
 * Key responsibilities:
 * 1. Registers with the focus machine via coordinator on mount
 * 2. Unregisters on unmount (coordinator handles focus restoration)
 * 3. Traps Tab key navigation within the component
 * 4. Handles Escape key to close
 * 5. Sets initial focus to specified element or first focusable
 *
 * Design principles:
 * - FocusTrap does NOT handle focus restoration - that's the coordinator's job
 * - Uses pushLayer/popLayer from useFocus hook
 * - StrictMode-safe with hasRegistered ref
 * - Portal-compatible with isPortal prop for aggressive stopPropagation
 *
 * @see FOCUS-BASED-KEYBOARD-HANDLING.md for architecture details
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useFocus, type FocusLayerType } from '../../hooks';

// =============================================================================
// TYPES
// =============================================================================

interface FocusTrapProps {
  /** Unique identifier for this dialog/overlay (used for debugging/tracking) */
  dialogId: string;

  /** Type of focus layer - defaults to 'dialog' */
  layerType?: FocusLayerType;

  /** Child content to render inside the trap */
  children: React.ReactNode;

  /** Called when user presses Escape or otherwise requests close */
  onClose: () => void;

  /** Ref to element that should receive initial focus */
  initialFocusRef?: React.RefObject<HTMLElement | null>;

  /** Whether to auto-focus first focusable element if no initialFocusRef (default: true) */
  autoFocus?: boolean;

  /**
   * Whether this FocusTrap is rendered inside a React Portal.
   * When true, stopPropagation is more aggressive to prevent keyboard
   * events from leaking through the portal to the grid.
   */
  isPortal?: boolean;

  /** Additional CSS class name for the wrapper div */
  className?: string;

  /** Additional inline styles for the wrapper div */
  style?: React.CSSProperties;

  /** aria-label for the dialog (accessibility) */
  'aria-label'?: string;

  /** aria-labelledby - ID of element that labels this dialog (accessibility) */
  'aria-labelledby'?: string;

  /** aria-describedby - ID of element that describes this dialog (accessibility) */
  'aria-describedby'?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * CSS selector for all focusable elements.
 * Excludes disabled elements and elements with tabindex="-1".
 */
const FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([tabindex="-1"])',
  '[href]:not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(', ');

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * FocusTrap - Manages focus containment for overlay components.
 *
 * @example
 * ```tsx
 * // Basic usage
 * function MyDialog({ onClose }) {
 * return (
 * <FocusTrap dialogId="my-dialog" onClose={onClose}>
 * <div className="dialog-content">
 * <input placeholder="First input" />
 * <button onClick={onClose}>Close</button>
 * </div>
 * </FocusTrap>
 * );
 * }
 *
 * // With initial focus ref
 * function SearchDialog({ onClose }) {
 * const searchInputRef = useRef<HTMLInputElement>(null);
 * return (
 * <FocusTrap
 * dialogId="search-dialog"
 * onClose={onClose}
 * initialFocusRef={searchInputRef}
 * >
 * <input ref={searchInputRef} placeholder="Search..." />
 * </FocusTrap>
 * );
 * }
 *
 * // For portal-rendered dialogs
 * function PortalDialog({ onClose }) {
 * return createPortal(
 * <FocusTrap dialogId="portal-dialog" onClose={onClose} isPortal>
 * <div className="dialog">...</div>
 * </FocusTrap>,
 * document.body
 * );
 * }
 * ```
 */
export function FocusTrap({
  dialogId,
  layerType = 'dialog',
  children,
  onClose,
  initialFocusRef,
  autoFocus = true,
  isPortal = false,
  className,
  style,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: FocusTrapProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const focus = useFocus();

  // Track if we've registered to prevent double-registration in StrictMode
  const hasRegistered = useRef(false);

  // ===========================================================================
  // FOCUS MACHINE REGISTRATION
  // ===========================================================================

  useEffect(() => {
    // Prevent double-registration in React StrictMode
    if (hasRegistered.current) return;
    hasRegistered.current = true;

    // Register this dialog with the focus machine
    focus.pushLayer(layerType, dialogId);

    // Set initial focus
    if (autoFocus) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (initialFocusRef?.current) {
          // Focus the specified element
          initialFocusRef.current.focus();
        } else if (containerRef.current) {
          // Focus the first focusable element
          const firstFocusable =
            containerRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
          if (firstFocusable) {
            firstFocusable.focus();
          } else {
            // No focusable elements - focus the container itself
            containerRef.current.focus();
          }
        }
      });
    }

    // Cleanup: unregister from focus machine
    // Note: Focus restoration is handled by the coordinator subscription,
    // NOT here. The coordinator watches for stack changes and restores focus.
    return () => {
      focus.popLayer();
      hasRegistered.current = false;
    };
  }, [dialogId, layerType]);
  // Note: We intentionally exclude autoFocus, initialFocusRef, and focus from deps
  // because we only want to register once on mount. The focus object from useFocus
  // is memoized and stable, but including it would make the linter happy at the
  // cost of potential re-registration bugs.

  // ===========================================================================
  // KEYBOARD HANDLING
  // ===========================================================================

  /**
   * Handle keyboard events within the focus trap.
   * - Tab: Cycle through focusable elements
   * - Shift+Tab: Cycle backwards
   * - Escape: Close the dialog
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // For portals, stop propagation of ALL keydown events to prevent
      // them from reaching the grid through the React event system.
      // This is necessary because React's synthetic event system bubbles
      // through portals to the React tree, not the DOM tree.
      if (isPortal) {
        e.stopPropagation();
      }

      // Escape closes the dialog
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!isPortal) e.stopPropagation();
        onClose();
        return;
      }

      // Tab trapping - keep focus within the dialog
      if (e.key === 'Tab') {
        const container = containerRef.current;
        if (!container) return;

        const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        // Shift+Tab on first element -> go to last
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
          return;
        }

        // Tab on last element -> go to first
        if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
          return;
        }
      }
    },
    [onClose, isPortal],
  );

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-focus-trap={dialogId}
      className={className}
      style={style}
    >
      {children}
    </div>
  );
}

// =============================================================================
// DEFAULT EXPORT
// =============================================================================
