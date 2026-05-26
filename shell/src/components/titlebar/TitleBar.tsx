/**
 * TitleBar - Cross-platform window title bar component
 *
 * Provides a custom title bar that works on both desktop (Tauri) and web platforms.
 *
 * ## Desktop (Tauri) Features:
 * - Click and drag to move window (via data-tauri-drag-region)
 * - Double-click to maximize/restore (handled automatically by Tauri)
 * - macOS: Leaves space for traffic lights (close/minimize/maximize)
 * - Windows/Linux: Full-width drag region
 *
 * ## Web Features:
 * - Same visual appearance (drag attributes are no-op)
 *
 * ## Layout:
 * ```
 * ┌──────────────────────────────────────────────────────────────┐
 * │ [Traffic Lights] │ [Leading] │  [Title/Center]  │ [Trailing]│
 * │     (macOS)      │ (optional)│   (draggable)    │ (actions) │
 * └──────────────────────────────────────────────────────────────┘
 * ```
 *
 * @example
 * ```tsx
 * <TitleBar
 *   title="My Document"
 *   trailing={<IconButton icon="gear" onClick={openSettings} />}
 * />
 * ```
 */

import React from 'react';

import { usePlatformInfo } from '../../hooks/use-platform-info';
import { cn } from '../ui/radix/styles';

// =============================================================================
// Types
// =============================================================================

export interface TitleBarProps {
  /** Title text displayed in the center (optional) */
  title?: string;

  /** Content rendered after the traffic light spacer (left side) */
  leading?: React.ReactNode;

  /** Content rendered in the center (replaces title if provided) */
  center?: React.ReactNode;

  /** Content rendered on the right side (settings, etc.) */
  trailing?: React.ReactNode;

  /** Additional className for the container */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * TitleBar - Cross-platform window title bar
 *
 * Integrates with Tauri for native window behaviors on desktop,
 * while providing a consistent appearance on web.
 */
export function TitleBar({
  title,
  leading,
  center,
  trailing,
  className,
}: TitleBarProps): React.JSX.Element {
  const { isMacOS, isDesktop } = usePlatformInfo();

  // Show traffic light spacer only on macOS desktop
  const showTrafficLightSpacer = isDesktop && isMacOS;

  return (
    <header
      // Tauri: Makes entire header draggable + double-click to maximize
      data-tauri-drag-region
      className={cn(
        // Layout
        'flex h-[38px] min-h-[38px] w-full items-center',
        // Background and border - using sidebar colors for consistency
        'bg-ss-surface-secondary border-b border-ss-border',
        // Prevent text selection during drag
        'select-none',
        className,
      )}
    >
      {/* macOS traffic light spacer - approximately 70px for the close/minimize/maximize buttons */}
      {showTrafficLightSpacer && (
        <div data-tauri-drag-region className="h-full w-[70px] shrink-0" aria-hidden="true" />
      )}

      {/* Leading content (optional) - not draggable */}
      {leading && (
        <div
          className="flex h-full shrink-0 items-center"
          // Tauri: Exclude from drag region for interactive elements
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {leading}
        </div>
      )}

      {/* Center section - main drag region */}
      <div
        data-tauri-drag-region
        className="flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden"
      >
        {center ??
          (title && <span className="truncate text-[13px] font-medium text-ss-text">{title}</span>)}
      </div>

      {/* Trailing content (settings button, etc.) - not draggable */}
      {trailing && (
        <div
          className="flex h-full shrink-0 items-center gap-1 pr-2"
          // Tauri: Exclude from drag region for interactive elements
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {trailing}
        </div>
      )}
    </header>
  );
}

export default TitleBar;
