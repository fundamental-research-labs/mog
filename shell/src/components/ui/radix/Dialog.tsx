/**
 * Dialog Primitive (Radix UI Wrapper)
 *
 * Modal dialog with header, body, and footer sections.
 * Built on @radix-ui/react-dialog for:
 * - Automatic focus trapping (no manual FocusTrap needed)
 * - Escape key to close
 * - Click outside to close (configurable)
 * - ARIA attributes for accessibility
 *
 * Components:
 * - Dialog: Main container with overlay and Radix behavior
 * - DialogHeader: Title bar with optional close button
 * - DialogBody: Scrollable content area (supports noPadding for custom layouts)
 * - DialogFooter: Action buttons with layout variants
 * - DialogToolbar: Secondary toolbar between header and body
 * - DialogTable: Table layout for list-based dialogs
 * - DialogTableRow: Row component for DialogTable
 *
 * @example Basic form dialog
 * ```tsx
 * <Dialog open={isOpen} onOpenChange={setIsOpen}>
 *   <DialogHeader onClose={() => setIsOpen(false)}>Settings</DialogHeader>
 *   <DialogBody>
 *     <FormField label="Name">
 *       <Input value={name} onChange={setName} />
 *     </FormField>
 *   </DialogBody>
 *   <DialogFooter>
 *     <Button variant="secondary" onClick={() => setIsOpen(false)}>Cancel</Button>
 *     <Button variant="primary" onClick={handleSave}>Save</Button>
 *   </DialogFooter>
 * </Dialog>
 * ```
 */

import type {
  ComponentProps,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from 'react';
import { useCallback, useRef } from 'react';

import * as RadixDialog from '@radix-ui/react-dialog';
import { CloseSvg } from '@mog/icons';
import { usePortalContainer } from '../../../contexts/PortalContainerContext';

// =============================================================================
// Icons
// =============================================================================

function CloseIcon() {
  return <CloseSvg style={{ width: 18, height: 18 }} />;
}

// =============================================================================
// Dialog
// =============================================================================

export interface DialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when the dialog open state changes (new Radix-style API) */
  onOpenChange?: (open: boolean) => void;
  /** Called when the dialog should close (legacy API, use onOpenChange for new code) */
  onClose?: () => void;
  /** Dialog content (use DialogHeader, DialogBody, DialogFooter) */
  children: ReactNode;
  /** Unique ID for the dialog (used for testing, not needed for focus trap - Radix handles it) */
  dialogId?: string;
  /** Width preset or custom width */
  width?: 'sm' | 'md' | 'lg' | 'xl' | number;
  /** Whether clicking the overlay closes the dialog */
  closeOnOverlayClick?: boolean;
  /** Allow pointer events to pass through the overlay to content behind the dialog. */
  allowPointerEventsBehind?: boolean;
  /** Additional class names for the dialog container */
  className?: string;
  /** Called when Radix auto-focuses the dialog content on open. Use e.preventDefault() to cancel default auto-focus. */
  onOpenAutoFocus?: (event: Event) => void;
  /** Called when Radix auto-focuses the previously focused element on close. */
  onCloseAutoFocus?: (event: Event) => void;
  /** Restore focus to the element active before this dialog opened. */
  restoreFocusOnClose?: boolean;
  /**
   * When set, the dialog cancels Radix's default auto-focus and focuses
   * the referenced element instead. Use for dialogs whose first
   * interactive control isn't the natural first focusable in the DOM
   * order (e.g. a category list whose roving tabindex anchor sits below
   * the close button). Ignored when `onOpenAutoFocus` is also passed —
   * the explicit callback wins for back-compat. When neither explicit
   * focus override is provided, the dialog focuses the first
   * `[data-confirm-button="true"]` so Enter activates the default action
   * before header chrome.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Extra `data-*` attributes to apply to the root `[role="dialog"]` element.
   * Used by app-eval scenarios and other instrumentation to read dialog-specific
   * metadata (e.g. `data-dv-alert-style` for the data-validation alert shape).
   */
  dataAttributes?: Record<`data-${string}`, string | number | boolean | undefined>;
  /**
   * Called when Enter is pressed inside the dialog with default semantics.
   * Symmetric with Radix's built-in `onEscapeKeyDown` — both fire on key
   * presses that have no other semantic in the focused control.
   *
   * Suppressed when focus is on a control whose own Enter behaviour would
   * conflict: textareas (insert newline), <select>/<a>, contenteditable,
   * action buttons (clicking the button is the action — Enter on Cancel
   * shouldn't both cancel and fire this). Selection-control items
   * (`role="option"`, `role="radio"`, `role="treeitem"`) DO fire — Excel
   * parity: pressing Enter on a Format Cells category option both records
   * the selection (via the button's own click) and commits the dialog.
   * Modifier keys (Shift/Ctrl/Meta/Alt) also suppress.
   *
   * Call `event.preventDefault()` to mark handled (the dialog already does
   * this when it fires the handler — useful for callers that want to deny
   * confirm based on local state without unsetting the prop).
   */
  onEnterKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

/**
 * Returns true when Enter on this target should be treated as the dialog's
 * default-action key rather than the focused control's own Enter behaviour.
 *
 * Selection items (`role="option"`, `role="radio"`, `role="treeitem"`) are
 * NOT treated as buttons — Enter on them should commit the dialog (Excel
 * parity for category lists / radio groups). Plain action buttons (Cancel,
 * OK, Apply in DialogFooter; tab triggers in tablists; menu items) DO
 * suppress so the button's click is the only effect.
 */
export function isEnterKeyDefaultAction(event: ReactKeyboardEvent<HTMLElement>): boolean {
  if (event.key !== 'Enter') return false;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.defaultPrevented) return false;

  const target = event.target as HTMLElement | null;
  if (!target) return true;

  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'A') return false;
  if (target.isContentEditable) return false;

  const role = target.getAttribute('role');

  // Tab triggers and menu items: explicit roles where Enter activates the
  // control and should NOT bubble to the dialog. (Radix renders these as
  // <button> today so the BUTTON branch below catches them, but check the
  // role explicitly so a future move to a non-button element still works.)
  if (
    role === 'tab' ||
    role === 'menuitem' ||
    role === 'menuitemcheckbox' ||
    role === 'menuitemradio'
  ) {
    return false;
  }

  if (tag === 'BUTTON' || target.closest('[role="button"]')) {
    const isSelectionItem =
      role === 'option' ||
      role === 'radio' ||
      role === 'treeitem' ||
      target.closest('[role="option"], [role="radio"], [role="treeitem"]') !== null;
    if (!isSelectionItem) return false;
  }

  return true;
}

type DialogContentProps = ComponentProps<typeof RadixDialog.Content>;
type DialogInteractOutsideEvent = Parameters<
  NonNullable<DialogContentProps['onInteractOutside']>
>[0];

/**
 * Radix reports both pointer-outside and focus-outside as "interact outside".
 * Modal dialogs should only use the pointer half for overlay-click dismissal:
 * focus can briefly move to <body> during legitimate internal re-renders
 * (for example a radio option that reveals more controls), and treating that
 * transient focus churn as dismissal closes the dialog under the user's click.
 */
export function shouldPreventDialogInteractOutside(
  event: DialogInteractOutsideEvent,
  closeOnOverlayClick: boolean,
): boolean {
  if (!closeOnOverlayClick) return true;

  const originalEvent = event.detail.originalEvent;
  return (
    (typeof FocusEvent !== 'undefined' && originalEvent instanceof FocusEvent) ||
    originalEvent.type === 'focusin' ||
    originalEvent.type === 'focusout'
  );
}

const widthClasses: Record<string, string> = {
  sm: 'w-[360px]',
  md: 'w-[480px]',
  lg: 'w-[600px]',
  xl: 'w-[800px]',
};

const overlayClasses = [
  'fixed inset-0',
  'bg-black/50',
  'z-ss-modal',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
  'duration-ss-fast',
].join(' ');

const contentClasses = [
  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
  'pointer-events-auto',
  'bg-ss-surface',
  'rounded-ss-lg',
  'shadow-ss-lg',
  'z-ss-modal',
  'max-h-[85vh] max-w-[90vw]',
  'flex flex-col overflow-hidden',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
  'duration-ss-fast',
  // Remove default outline on focus
  'outline-none',
].join(' ');

/**
 * Dialog - Modal dialog primitive with Radix UI for accessibility.
 *
 * @example
 * ```tsx
 * <Dialog open={isOpen} onOpenChange={setIsOpen}>
 *   <DialogHeader onClose={() => setIsOpen(false)}>Edit Settings</DialogHeader>
 *   <DialogBody>
 *     <p>Dialog content goes here</p>
 *   </DialogBody>
 *   <DialogFooter>
 *     <Button variant="secondary" onClick={() => setIsOpen(false)}>Cancel</Button>
 *     <Button variant="primary" onClick={handleSave}>Save</Button>
 *   </DialogFooter>
 * </Dialog>
 * ```
 */
export function Dialog({
  open,
  onOpenChange,
  onClose,
  children,
  dialogId,
  width = 'md',
  closeOnOverlayClick = true,
  allowPointerEventsBehind = false,
  className = '',
  onOpenAutoFocus,
  onCloseAutoFocus,
  restoreFocusOnClose = true,
  initialFocusRef,
  dataAttributes,
  onEnterKeyDown,
}: DialogProps) {
  const portalContainer = usePortalContainer();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const widthStyle = typeof width === 'number' ? { width: `${width}px` } : undefined;
  const widthClass = typeof width === 'string' ? widthClasses[width] : '';
  const overlayPointerEventsClass = allowPointerEventsBehind
    ? 'pointer-events-none'
    : 'pointer-events-auto';

  // Support both legacy onClose and new onOpenChange API
  const handleOpenChange = (newOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(newOpen);
    } else if (!newOpen && onClose) {
      onClose();
    }
  };

  // Explicit focus hooks win so existing call-sites keep their behaviour
  // exactly. Otherwise default to the dialog's confirm action when present,
  // before Radix can land on header chrome such as the close button.
  const resolvedAutoFocus =
    onOpenAutoFocus ??
    (initialFocusRef
      ? (event: Event) => {
          const target = initialFocusRef.current;
          if (!target) return;
          event.preventDefault();
          target.focus();
        }
      : (event: Event) => {
          const target = contentRef.current?.querySelector<HTMLElement>(
            '[data-confirm-button="true"]',
          );
          if (!target) return;
          event.preventDefault();
          target.focus();
        });

  const captureReturnFocusTarget = useCallback(() => {
    if (!restoreFocusOnClose || typeof document === 'undefined') return;

    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      activeElement !== document.documentElement
    ) {
      returnFocusRef.current = activeElement;
    }
  }, [restoreFocusOnClose]);

  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      captureReturnFocusTarget();
      resolvedAutoFocus?.(event);
    },
    [captureReturnFocusTarget, resolvedAutoFocus],
  );

  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);

      const target = returnFocusRef.current;
      returnFocusRef.current = null;

      if (event.defaultPrevented || !restoreFocusOnClose || !target || !target.isConnected) {
        return;
      }

      event.preventDefault();
      target.focus({ preventScroll: true });
    },
    [onCloseAutoFocus, restoreFocusOnClose],
  );

  return (
    <RadixDialog.Root open={open} onOpenChange={handleOpenChange} modal={!allowPointerEventsBehind}>
      <RadixDialog.Portal container={portalContainer}>
        <RadixDialog.Overlay
          className={`${overlayClasses} ${overlayPointerEventsClass}`}
          data-testid="dialog-overlay"
        />
        <RadixDialog.Content
          ref={contentRef}
          className={`${contentClasses} ${widthClass} ${className}`}
          style={widthStyle}
          aria-modal={allowPointerEventsBehind ? undefined : 'true'}
          data-dialog-id={dialogId}
          onPointerDownOutside={(event) => {
            if (!closeOnOverlayClick) event.preventDefault();
          }}
          onFocusOutside={(event) => {
            event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (shouldPreventDialogInteractOutside(event, closeOnOverlayClick)) {
              event.preventDefault();
            }
          }}
          onOpenAutoFocus={handleOpenAutoFocus}
          onCloseAutoFocus={handleCloseAutoFocus}
          onKeyDown={
            onEnterKeyDown
              ? (event) => {
                  if (!isEnterKeyDefaultAction(event)) return;
                  event.preventDefault();
                  onEnterKeyDown(event);
                }
              : undefined
          }
          {...(dataAttributes ?? {})}
        >
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

// =============================================================================
// DialogHeader
// =============================================================================

export interface DialogHeaderProps {
  /** Header title content */
  children: ReactNode;
  /** Called when close button is clicked (optional - hides close button if not provided) */
  onClose?: () => void;
  /** Additional class names */
  className?: string;
  /**
   * Optional `data-testid` for the close button. Used by the chrome-symmetry
   * contract (e.g. `panel-find-close`) so harness scenarios can locate the
   * dialog's own visible close affordance.
   */
  closeTestId?: string;
}

/**
 * DialogHeader - Header section with title and optional close button.
 */
export function DialogHeader({
  children,
  onClose,
  className = '',
  closeTestId,
}: DialogHeaderProps) {
  return (
    <div
      className={`px-5 py-4 border-b border-ss-border flex items-center justify-between shrink-0 ${className}`}
    >
      <RadixDialog.Title className="text-subtitle font-semibold text-text m-0">
        {children}
      </RadixDialog.Title>
      {onClose && (
        <RadixDialog.Close asChild>
          <button
            type="button"
            className="p-1 rounded text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors duration-ss-fast"
            onClick={onClose}
            aria-label="Close"
            data-testid={closeTestId}
          >
            <CloseIcon />
          </button>
        </RadixDialog.Close>
      )}
    </div>
  );
}

// =============================================================================
// DialogBody
// =============================================================================

export interface DialogBodyProps {
  /** Body content */
  children: ReactNode;
  /** Remove default padding (for custom layouts like tables) */
  noPadding?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * DialogBody - Main content section with padding and scrolling.
 *
 * Use `noPadding` prop for list/table dialogs instead of `!p-0` override.
 */
export function DialogBody({ children, noPadding = false, className = '' }: DialogBodyProps) {
  const paddingClass = noPadding ? '' : 'p-5';
  return (
    <RadixDialog.Description asChild>
      <div className={`overflow-auto flex-1 ${paddingClass} ${className}`}>{children}</div>
    </RadixDialog.Description>
  );
}

// =============================================================================
// DialogFooter
// =============================================================================

export interface DialogFooterProps {
  /** Footer content (typically buttons) */
  children: ReactNode;
  /**
   * Button layout:
   * - 'end': Buttons aligned to right (default)
   * - 'between': Space between left and right button groups
   * - 'start': Buttons aligned to left
   */
  layout?: 'end' | 'between' | 'start';
  /** Additional class names */
  className?: string;
}

const layoutClasses: Record<string, string> = {
  end: 'justify-end',
  between: 'justify-between',
  start: 'justify-start',
};

/**
 * DialogFooter - Footer section with action buttons.
 *
 * Use `layout` prop instead of `!justify-between` override.
 *
 * @example Default (buttons right-aligned)
 * ```tsx
 * <DialogFooter>
 *   <Button variant="secondary">Cancel</Button>
 *   <Button variant="primary">Save</Button>
 * </DialogFooter>
 * ```
 *
 * @example Space between (left and right button groups)
 * ```tsx
 * <DialogFooter layout="between">
 *   <Button variant="danger">Delete</Button>
 *   <div className="flex gap-3">
 *     <Button variant="secondary">Cancel</Button>
 *     <Button variant="primary">Save</Button>
 *   </div>
 * </DialogFooter>
 * ```
 */
export function DialogFooter({ children, layout = 'end', className = '' }: DialogFooterProps) {
  return (
    <div
      className={`px-5 py-4 border-t border-ss-border flex gap-3 shrink-0 ${layoutClasses[layout]} ${className}`}
    >
      {children}
    </div>
  );
}

// =============================================================================
// DialogToolbar
// =============================================================================

interface DialogToolbarProps {
  /** Toolbar content (filters, counts, actions) */
  children: ReactNode;
  /** Additional class names */
  className?: string;
}

/**
 * DialogToolbar - Secondary toolbar between header and body.
 *
 * Use for dialogs that need filtering, counts, or secondary actions.
 * Does NOT use bg-ss-surface-secondary to avoid visual banding.
 */
export function DialogToolbar({ children, className = '' }: DialogToolbarProps) {
  return (
    <div
      className={`px-5 py-3 border-b border-ss-border-light flex items-center justify-between shrink-0 ${className}`}
    >
      {children}
    </div>
  );
}

// =============================================================================
// DialogTable
// =============================================================================

interface DialogTableProps {
  /** Column headers */
  columns: string[];
  /** Grid column widths (e.g., "1fr 120px 100px") */
  columnWidths?: string;
  /** Table rows (use DialogTableRow) */
  children: ReactNode;
  /** Minimum height for the table body */
  minHeight?: number;
  /** Additional class names */
  className?: string;
}

/**
 * DialogTable - Table layout for list-based dialogs.
 *
 * Use with DialogTableRow for consistent list dialog styling.
 * Header uses `text-caption` (12px) for readable column headers.
 */
export function DialogTable({
  columns,
  columnWidths,
  children,
  minHeight = 200,
  className = '',
}: DialogTableProps) {
  const gridStyle: CSSProperties | undefined = columnWidths
    ? { gridTemplateColumns: columnWidths }
    : undefined;

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Table Header */}
      <div
        className="grid px-5 py-2.5 border-b border-ss-border-light text-caption font-medium text-ss-text-secondary uppercase tracking-wide"
        style={gridStyle}
      >
        {columns.map((col) => (
          <span key={col}>{col}</span>
        ))}
      </div>
      {/* Table Body */}
      <div className="flex-1 overflow-auto" style={{ minHeight }}>
        {children}
      </div>
    </div>
  );
}

// =============================================================================
// DialogTableRow
// =============================================================================

interface DialogTableRowProps {
  /** Row content (should match column structure) */
  children: ReactNode;
  /** Grid column widths (should match DialogTable) */
  columnWidths?: string;
  /** Whether this row is selected */
  isSelected?: boolean;
  /** Called when row is clicked */
  onClick?: () => void;
  /** Additional class names */
  className?: string;
}

/**
 * DialogTableRow - Row component for DialogTable.
 *
 * Provides consistent hover, selection, and click behavior for table rows.
 */
export function DialogTableRow({
  children,
  columnWidths,
  isSelected = false,
  onClick,
  className = '',
}: DialogTableRowProps) {
  const gridStyle: CSSProperties | undefined = columnWidths
    ? { gridTemplateColumns: columnWidths }
    : undefined;

  const baseClasses =
    'grid px-5 py-3 border-b border-ss-border-light items-center transition-colors';
  const interactiveClasses = onClick ? 'cursor-pointer' : '';
  const stateClasses = isSelected ? 'bg-ss-primary-lighter' : 'hover:bg-ss-surface-hover';

  return (
    <div
      className={`${baseClasses} ${interactiveClasses} ${stateClasses} ${className}`}
      style={gridStyle}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
