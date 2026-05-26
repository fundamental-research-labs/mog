import type { KeyboardEvent } from 'react';

import { useUIStore } from '../../infra/context';

/**
 * Suppresses a Dialog's `onEnterKeyDown` while range-selection mode is active.
 *
 * `CollapsibleRangeInput` registers a global window keydown listener that
 * completes the range on Enter. Without this guard, Dialog's keydown handler
 * (a React synthetic event on Content) fires first and commits the dialog
 * before the range listener runs.
 *
 * `MinimizableDialog` applies this automatically. Plain `<Dialog>` instances
 * that contain `CollapsibleRangeInput` must wrap their own handler:
 *
 * ```tsx
 * const onEnterKeyDown = useRangeSelectionEnterGuard(handleOk);
 * <Dialog onEnterKeyDown={onEnterKeyDown} ... />
 * ```
 */
export function useRangeSelectionEnterGuard(
  handler: ((event: KeyboardEvent<HTMLElement>) => void) | undefined,
): ((event: KeyboardEvent<HTMLElement>) => void) | undefined {
  const rangeSelectionActive = useUIStore((s) => s.rangeSelectionMode.active);

  if (!handler) return undefined;
  return (event: KeyboardEvent<HTMLElement>) => {
    if (rangeSelectionActive) return;
    handler(event);
  };
}
