/**
 * Tooltip - Radix UI Wrapper
 *
 * Excel-style tooltip with keyboard shortcut support.
 * Matches Excel 365 appearance: light background, subtle border, no arrow.
 *
 * Features:
 * - Keyboard shortcut display (muted, inline with title)
 * - 500ms delay (Excel default, configured at app root)
 * - Smart positioning with flip behavior (handled by Radix)
 * - Light background with subtle border (Excel-style)
 * - Optional description and "Learn more" link
 * - Shared tooltip timing via TooltipProvider at app root (hover quickly
 *   between buttons = no delay, improving UX)
 *
 * Architecture: TooltipProvider should be set up at the app root.
 * This allows tooltips to share timing context - when you hover from one
 * button to another quickly, the second tooltip shows immediately.
 *
 */

import * as RadixTooltip from '@radix-ui/react-tooltip';
import React, { memo, type ReactNode } from 'react';
import { usePortalContainer } from '../../../contexts/PortalContainerContext';

export interface TooltipProps {
  /** Main tooltip text */
  title: string;
  /** Keyboard shortcut (e.g., "Ctrl+B") - displayed in muted style after title */
  shortcut?: string;
  /** Optional description - displayed below title in smaller text */
  description?: string;
  /** Optional URL for "Tell me more" link - opens in new tab */
  learnMoreUrl?: string;
  /** Optional label for the learn more link - defaults to "Tell me more" */
  learnMoreLabel?: string;
  /** The element that triggers the tooltip - must be a single React element */
  children: ReactNode;
  /** Preferred side position - will flip if not enough space */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Alignment relative to trigger */
  align?: 'start' | 'center' | 'end';
  /** Delay before showing (defaults to 500ms) */
  delayDuration?: number;
  /** @deprecated Use `delayDuration` instead */
  delay?: number;
  /** @deprecated Use `side` instead */
  position?: 'top' | 'bottom';
  /** Disable the tooltip */
  disabled?: boolean;
}

// Content container classes - Excel-style light background
const contentClasses = [
  // Tooltip content is portaled under the shell portal host, which is
  // pointer-transparent so empty portal space never blocks the app.
  'pointer-events-auto',
  // Layout
  'px-1.5 py-1',
  'max-w-[240px]',
  // Colors - Excel-style light background
  'bg-ss-surface',
  'border border-ss-border',
  // Shape
  'rounded-ss',
  // Shadow
  'shadow-ss-sm',
  // Z-index
  'z-ss-tooltip',
  // Animation
  'data-[state=delayed-open]:animate-in',
  'data-[state=delayed-open]:fade-in-0',
  'data-[state=delayed-open]:zoom-in-95',
  'data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0',
  'data-[state=closed]:zoom-out-95',
  'data-[side=bottom]:slide-in-from-top-2',
  'data-[side=top]:slide-in-from-bottom-2',
  'data-[side=left]:slide-in-from-right-2',
  'data-[side=right]:slide-in-from-left-2',
  'duration-ss-fast',
].join(' ');

/**
 * Tooltip component wrapping Radix UI Tooltip.
 *
 * Supports backward compatibility with existing `position` and `delay` props,
 * while also supporting new Radix-style `side`, `align`, and `delayDuration` props.
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders when parent re-renders.
 * Toolbar groups re-render on cell format changes (activeCellFormat), but Tooltip
 * props rarely change - memoization prevents 200+ unnecessary re-renders per session.
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
 */
export const Tooltip = memo(function Tooltip({
  title,
  shortcut,
  description,
  learnMoreUrl,
  learnMoreLabel,
  children,
  side,
  align = 'start',
  delayDuration,
  delay,
  position,
  disabled = false,
}: TooltipProps) {
  // Handle legacy props for backward compatibility
  const resolvedSide = side ?? position ?? 'bottom';
  const resolvedDelay = delayDuration ?? delay ?? 500;
  const portalContainer = usePortalContainer();

  // If disabled, just render children without tooltip
  if (disabled) {
    return <>{children}</>;
  }

  // Determine if we need pointer-events for interactive content
  const hasInteractiveContent = Boolean(learnMoreUrl);

  // Use Root directly - Provider is at app root (Spreadsheet.tsx)
  // This enables shared timing: hovering quickly between buttons shows
  // the second tooltip immediately (skipDelayDuration at Provider level)
  return (
    <RadixTooltip.Root delayDuration={resolvedDelay}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal container={portalContainer}>
        <RadixTooltip.Content
          side={resolvedSide}
          align={align}
          sideOffset={8}
          className={contentClasses}
          // Allow pointer events only if we have interactive content (links)
          onPointerDownOutside={(e) => {
            if (!hasInteractiveContent) {
              e.preventDefault();
            }
          }}
        >
          {/* Title + Shortcut on same line - compact 11px */}
          <div className="flex items-baseline gap-1 text-hint">
            <span className="font-semibold text-ss-text">{title}</span>
            {shortcut && (
              <span className="text-ss-text-tertiary whitespace-nowrap">({shortcut})</span>
            )}
          </div>

          {/* Description below if provided */}
          {description && (
            <p className="mt-0.5 text-ribbon-compact text-ss-text-secondary leading-tight">
              {description}
            </p>
          )}

          {/* Learn more link if provided */}
          {learnMoreUrl && (
            <a
              href={learnMoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ss-primary underline hover:text-ss-primary-hover mt-1 text-ribbon-compact inline-block"
              onClick={(e) => e.stopPropagation()}
            >
              {learnMoreLabel || 'Tell me more'}
            </a>
          )}

          {/* No arrow - Excel-style has clean edges */}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
});

// =============================================================================
// TooltipProvider - wraps RadixTooltip.Provider with sensible defaults
// =============================================================================

export interface TooltipProviderProps {
  children: ReactNode;
  /** Delay in ms before tooltip shows. @default 500 */
  delayDuration?: number;
  /** Delay in ms before skipping to the next tooltip when hovering quickly between triggers. @default 300 */
  skipDelayDuration?: number;
}

/**
 * TooltipProvider wraps Radix UI's TooltipProvider with Excel-style defaults.
 *
 * Place this at the app root so tooltips share timing context - when you hover
 * from one button to another quickly, the second tooltip shows immediately
 * (controlled by skipDelayDuration).
 *
 * @example
 * ```tsx
 * import { TooltipProvider } from '@mog/shell';
 *
 * <TooltipProvider>
 *   <App />
 * </TooltipProvider>
 * ```
 */
export function TooltipProvider({
  children,
  delayDuration = 500,
  skipDelayDuration = 300,
}: TooltipProviderProps): React.JSX.Element {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration}>
      {children}
    </RadixTooltip.Provider>
  );
}

export default Tooltip;
