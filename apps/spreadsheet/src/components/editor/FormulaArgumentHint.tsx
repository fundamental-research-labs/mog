/**
 * Formula Argument Hint Component
 *
 * Displays a tooltip showing the current function's signature with the
 * current argument highlighted. Similar to Excel's IntelliSense.
 *
 * Design principles:
 * - Stateless component - all state from editor machine via props
 * - Pure UI - no business logic
 * - Follows existing Tailwind patterns from InsertFunctionDialog
 *
 */

import { useMemo } from 'react';

import type { FunctionInfo } from '@mog-sdk/contracts/api';
import type { FunctionArgument } from '@mog-sdk/contracts/utils';
// =============================================================================
// Types
// =============================================================================

export interface FormulaArgumentHintProps {
  /** Function metadata from calculator bridge */
  functionInfo: FunctionInfo;
  /** Current argument index (0-based) */
  currentArgIndex: number;
  /** Screen position for the tooltip */
  position: { x: number; y: number };
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
  position,
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

  // If no arguments metadata available, show basic syntax
  if (args.length === 0) {
    return (
      <div
        className="fixed z-ss-popover bg-ss-surface border border-ss-border rounded shadow-ss-lg p-3 text-body"
        style={{
          left: position.x,
          top: position.y,
          maxWidth,
        }}
        role="tooltip"
        aria-live="polite"
      >
        {/* Function name and basic syntax */}
        <div className="font-ss-mono text-text-ss-primary">
          <span className="font-semibold text-ss-primary">{functionInfo.name}</span>
          <span className="text-ss-text-secondary">
            ({functionInfo.syntax.replace(/^[^(]*\(/, '').replace(/\)$/, '')})
          </span>
        </div>

        {/* Function description */}
        <div className="mt-2 text-body-sm text-ss-text-secondary border-t border-ss-border-light pt-2">
          {functionInfo.description}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed z-ss-popover bg-ss-surface border border-ss-border rounded shadow-ss-lg p-3 text-body"
      style={{
        left: position.x,
        top: position.y,
        maxWidth,
      }}
      role="tooltip"
      aria-live="polite"
    >
      {/* Function signature with current argument highlighted */}
      <div className="font-ss-mono text-text-ss-primary leading-relaxed">
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
              {arg.optional ? ']' : ''}
            </span>
            {arg.repeating ? <span className="text-text-muted">, ...</span> : null}
            {i < args.length - 1 ? <span className="text-text-muted">, </span> : ''}
          </span>
        ))}
        <span className="text-ss-text-secondary">)</span>
      </div>

      {/* Current argument description */}
      {currentArg && (
        <div className="mt-2 text-body-sm text-text border-t border-ss-border-light pt-2">
          <span className="font-medium text-text-ss-primary">{currentArg.name}</span>
          <span className="text-text-muted"> ({currentArg.type})</span>
          {currentArg.optional && <span className="text-text-muted italic"> - optional</span>}
          <div className="mt-1 text-ss-text-secondary">{currentArg.description}</div>
        </div>
      )}

      {/* Function description (collapsed at bottom) */}
      <div className="mt-2 text-caption text-text-muted border-t border-ss-border-light pt-2">
        {functionInfo.description}
      </div>
    </div>
  );
}
