/**
 * Formula Argument Hint Component
 *
 * Displays a tooltip showing the current function's signature with the
 * current argument highlighted, as an inline IntelliSense-style tooltip.
 *
 * Design principles:
 * - Stateless component - all state from editor machine via props
 * - Pure UI - no business logic
 * - Self-positioning: clamps to the viewport using its OWN measured size
 *   rather than a guessed width/height, so it never overflows the screen or
 *   covers its anchor (e.g. the formula bar).
 * - Follows existing Tailwind patterns from InsertFunctionDialog
 *
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { FunctionInfo } from '@mog-sdk/contracts/api';
import type { FunctionArgument } from '@mog-sdk/contracts/utils';
// =============================================================================
// Constants
// =============================================================================

/** Minimum distance the tooltip keeps from the viewport edges. */
const VIEWPORT_PADDING = 8;
/** Gap between the tooltip and its anchor. */
const ANCHOR_GAP = 4;

// =============================================================================
// Types
// =============================================================================

/** Anchor rect (viewport coordinates) the tooltip is positioned against. */
export interface ArgumentHintAnchor {
  left: number;
  top: number;
  bottom: number;
}

export interface FormulaArgumentHintProps {
  /** Function metadata from calculator bridge */
  functionInfo: FunctionInfo;
  /** Current argument index (0-based) */
  currentArgIndex: number;
  /** Anchor rect (viewport coordinates) the tooltip is positioned against. */
  anchor: ArgumentHintAnchor;
  /**
   * Preferred placement relative to the anchor. Flips to the other side when
   * there isn't room (measured against the tooltip's real height). Defaults to
   * 'above' (used for in-cell editing). The formula bar uses 'below' since it
   * sits at the top of the viewport.
   */
  preferredPlacement?: 'above' | 'below';
  /** Optional maximum width */
  maxWidth?: number;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Tooltip that shows function signature with current argument highlighted.
 * Displayed when the cursor is inside function parentheses.
 */
export function FormulaArgumentHint({
  functionInfo,
  currentArgIndex,
  anchor,
  preferredPlacement = 'above',
  maxWidth = 400,
}: FormulaArgumentHintProps) {
  const args = functionInfo.arguments ?? [];

  // Clamp arg index to valid range (handle repeating args overflow)
  const displayArgIndex = useMemo(() => {
    if (args.length === 0) return -1;

    // Check if last arg is repeating (variadic)
    const lastArg = args[args.length - 1];
    if (lastArg?.repeating && currentArgIndex >= args.length - 1) {
      return args.length - 1;
    }

    return Math.min(currentArgIndex, args.length - 1);
  }, [args, currentArgIndex]);

  const currentArg = displayArgIndex >= 0 ? args[displayArgIndex] : null;

  // The hint shows just the one-line function signature by default so it covers
  // as little of the grid as possible. Hovering expands it to reveal the
  // argument and function descriptions.
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Boolean(currentArg) || Boolean(functionInfo.description);

  // Position from the tooltip's MEASURED size so it never overflows the
  // viewport or covers its anchor. coords is null until the first measurement
  // completes; we render hidden during that frame to avoid a flash at the
  // unclamped position.
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;

    // Horizontal: align with the anchor's left edge, shift in if it overflows.
    let left = anchor.left;
    if (left + width > viewportWidth - VIEWPORT_PADDING) {
      left = viewportWidth - width - VIEWPORT_PADDING;
    }
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;

    // Vertical: honour the preferred side, flip to the other when it doesn't
    // fit, fall back to clamping when neither side has room.
    const aboveTop = anchor.top - height - ANCHOR_GAP;
    const belowTop = anchor.bottom + ANCHOR_GAP;
    const fitsAbove = aboveTop >= VIEWPORT_PADDING;
    const fitsBelow = belowTop + height <= viewportHeight - VIEWPORT_PADDING;

    let top: number;
    if (preferredPlacement === 'below') {
      top = fitsBelow ? belowTop : fitsAbove ? aboveTop : VIEWPORT_PADDING;
    } else {
      top = fitsAbove
        ? aboveTop
        : fitsBelow
          ? belowTop
          : Math.max(VIEWPORT_PADDING, viewportHeight - height - VIEWPORT_PADDING);
    }

    setCoords((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, [
    anchor.left,
    anchor.top,
    anchor.bottom,
    preferredPlacement,
    // Content/size affects the measured rect, so re-measure when it changes.
    functionInfo,
    displayArgIndex,
    expanded,
  ]);

  // Expand/collapse is driven by pointer position (below) rather than
  // onMouseEnter/Leave so the hint can stay pointer-events-none: clicks pass
  // through to the grid, preserving click-to-insert-reference while editing a
  // formula. We toggle `expanded` when the pointer is over the hint's rect.
  useEffect(() => {
    if (!hasDetails) return;
    const onMove = (event: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const inside =
        event.clientX >= r.left &&
        event.clientX <= r.right &&
        event.clientY >= r.top &&
        event.clientY <= r.bottom;
      setExpanded((prev) => (prev === inside ? prev : inside));
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [hasDetails]);

  const containerStyle = {
    left: coords?.left ?? anchor.left,
    top: coords?.top ?? anchor.top,
    maxWidth,
    visibility: coords ? ('visible' as const) : ('hidden' as const),
  };

  // Collapsed it's a single line sized to fit within the column-header height
  // (≈24px): compact font + tight padding. Expanded gets more breathing room.
  // pointer-events-none keeps clicks passing through to the cells underneath.
  const containerClassName = `fixed z-ss-popover pointer-events-none bg-ss-surface border border-ss-border rounded shadow-ss-lg text-caption ${
    expanded ? 'px-3 py-2' : 'px-2 py-0.5'
  }`;

  // Small affordance that the hint expands on hover (no-op visually otherwise).
  const expandChevron = hasDetails ? (
    <span
      aria-hidden
      className={`ml-2 inline-block text-caption text-text-muted transition-transform ${
        expanded ? 'rotate-180' : ''
      }`}
    >
      ▾
    </span>
  ) : null;

  // If no arguments metadata available, show basic syntax
  if (args.length === 0) {
    return (
      <div
        ref={ref}
        className={containerClassName}
        style={containerStyle}
        role="tooltip"
        aria-live="polite"
      >
        {/* Function name and basic syntax (always shown) */}
        <div className="flex items-baseline font-ss-mono text-text-ss-primary">
          <span className="whitespace-nowrap">
            <span className="font-semibold text-ss-primary">{functionInfo.name}</span>
            <span className="text-ss-text-secondary">
              ({functionInfo.syntax.replace(/^[^(]*\(/, '').replace(/\)$/, '')})
            </span>
          </span>
          {expandChevron}
        </div>

        {/* Function description (revealed on hover) */}
        {expanded && functionInfo.description && (
          <div className="mt-2 text-body-sm text-ss-text-secondary border-t border-ss-border-light pt-2">
            {functionInfo.description}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={containerClassName}
      style={containerStyle}
      role="tooltip"
      aria-live="polite"
    >
      {/* Function signature with current argument highlighted (always shown) */}
      <div className="flex items-baseline font-ss-mono text-text-ss-primary leading-tight">
        <span className="whitespace-nowrap">
          <span className="font-semibold text-ss-primary">{functionInfo.name}</span>
          <span className="text-ss-text-secondary">(</span>
          {args.map((arg: FunctionArgument, i: number) => (
            <span key={arg.name}>
              <span
                className={
                  i === displayArgIndex
                    ? 'font-bold text-ss-primary bg-ss-primary-lighter px-1 rounded'
                    : 'text-ss-text-secondary'
                }
              >
                {arg.optional ? '[' : ''}
                {arg.name}
                {arg.repeating ? ', ...' : ''}
                {arg.optional ? ']' : ''}
              </span>
              {i < args.length - 1 ? <span className="text-text-muted">, </span> : ''}
            </span>
          ))}
          <span className="text-ss-text-secondary">)</span>
        </span>
        {expandChevron}
      </div>

      {/* Details (revealed on hover) */}
      {expanded && (
        <>
          {/* Current argument description */}
          {currentArg && (
            <div className="mt-2 text-body-sm text-text border-t border-ss-border-light pt-2">
              <span className="font-medium text-text-ss-primary">{currentArg.name}</span>
              <span className="text-text-muted"> ({currentArg.type})</span>
              {currentArg.optional && <span className="text-text-muted italic"> - optional</span>}
              <div className="mt-1 text-ss-text-secondary">{currentArg.description}</div>
            </div>
          )}

          {/* Function description */}
          {functionInfo.description && (
            <div className="mt-2 text-caption text-text-muted border-t border-ss-border-light pt-2">
              {functionInfo.description}
            </div>
          )}
        </>
      )}
    </div>
  );
}
