/**
 * useChordModeSnapshot — display-only subscription to coordinator chord state.
 *
 * The KeyTip overlay layer reads this hook to know whether the
 * coordinator is currently buffering an Alt-prefixed chord and how
 * deep the chord is. The coordinator is the single source of truth
 *; this hook is a thin React adapter over
 * {@link KeyboardCoordinator.subscribeChord} +
 * {@link KeyboardCoordinator.getChordSnapshot}.
 *
 * No setter / dispatcher is exposed — by design. Consumers must not
 * cancel, advance, or activate keytip mode through this hook; those
 * transitions belong to the coordinator's keyboard event listener
 * and ribbon-tab action handlers (`SWITCH_RIBBON_TAB`). demotes
 * the KeyTip system to display-only data.
 *
 */

import { useCallback, useSyncExternalStore } from 'react';

import { useCoordinator } from '../../../hooks/shared/use-coordinator';
import type { ChordSnapshot } from './keyboard-coordinator';

/**
 * Subscribe to the keyboard-coordinator's chord-buffer state.
 *
 * Returns a snapshot of the chord buffer:
 * - `active`: whether a chord buffer is currently in flight
 * (post Alt-tap and not yet completed/cancelled).
 * - `depth`: the cursor of the deepest pending candidate. `0` after
 * a clean Alt-tap before any follow-on; `1` after `Alt+H` etc.
 * - `candidateCount`: how many shortcuts are still pending.
 *
 * The returned object identity changes only when the underlying chord
 * state mutates, so consumers can pass the result through
 * `useMemo`/`useEffect` deps without thrashing.
 */
export function useChordModeSnapshot(): ChordSnapshot {
  const coordinator = useCoordinator();
  const keyboardCoordinator = coordinator.input.keyboardCoordinator;

  return useSyncExternalStore(
    useCallback(
      (callback: () => void) => keyboardCoordinator.subscribeChord(callback),
      [keyboardCoordinator],
    ),
    useCallback(() => keyboardCoordinator.getChordSnapshot(), [keyboardCoordinator]),
    useCallback(() => keyboardCoordinator.getChordSnapshot(), [keyboardCoordinator]),
  );
}
