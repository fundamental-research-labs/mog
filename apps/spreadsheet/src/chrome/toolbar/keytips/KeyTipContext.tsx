/**
 * KeyTip Context
 *
 * Display-only React context that exposes the keyboard-coordinator's
 * chord-buffer state to KeyTip rendering surfaces. Pre- this file
 * also installed a parallel `window.addEventListener('keydown', …)`
 * state machine for Alt-prefixed navigation; deletes that listener
 * and cedes ownership of the Alt-tap detector, chord buffer, ESC
 * cancel, and click-outside cancel to the coordinator.
 *
 * The remaining responsibilities of this provider are:
 * - Read the coordinator's {@link ChordSnapshot} via
 * {@link useChordModeSnapshot} (a `useSyncExternalStore` adapter).
 * - Project that snapshot into the legacy `KeyTipMode` shape so
 * {@link KeyTipOverlay} (display) and any other read-only
 * consumers don't need to know about the coordinator internals.
 *
 * No setters, dispatchers, or imperative methods are exposed. Tab
 * activation flows through the typed `SWITCH_RIBBON_TAB` action
 * (handler at `apps/spreadsheet/src/actions/handlers/ui/keytip-handlers.ts`),
 * which is the canonical home for any side effect that used to live
 * in the deleted `onTabActivated`/`onExit` callbacks.
 *
 * @see apps/spreadsheet/src/systems/input/keyboard/use-chord-mode-snapshot.ts
 */

import type React from 'react';
import { createContext, useContext, useMemo } from 'react';

import { useUIStoreApi } from '../../../infra/context';
import { useStore } from 'zustand';
import { useChordModeSnapshot } from '../../../systems/input/keyboard';
import type { KeyTipMode } from './types';

/**
 * KeyTip Context Value (display-only after).
 */
interface KeyTipContextValue {
  /** Current keytip mode, projected from the coordinator's chord snapshot. */
  mode: KeyTipMode;
}

// Create context with undefined default (must use provider)
const KeyTipContext = createContext<KeyTipContextValue | undefined>(undefined);

/**
 * Hook to access KeyTip context.
 * Must be used within a KeyTipProvider.
 */
export function useKeyTips(): KeyTipContextValue {
  const context = useContext(KeyTipContext);
  if (!context) {
    throw new Error('useKeyTips must be used within KeyTipProvider');
  }
  return context;
}

/**
 * KeyTip Provider Props.
 *
 * `onTabActivated` and `onExit` callbacks are removed. Tab
 * switches are dispatched through `SWITCH_RIBBON_TAB`; exit flows
 * through the coordinator's chord-cancel paths.
 */
interface KeyTipProviderProps {
  children: React.ReactNode;
}

/**
 * Project the coordinator's chord snapshot into the {@link KeyTipMode}
 * shape consumed by display surfaces.
 *
 * Mapping:
 * - `active === false` → `{ state: 'inactive' }` — overlay renders nothing.
 * - `active && depth === 0` → `{ state: 'showing', level: 'tabs' }` —
 * post Alt-tap, no follow-on yet; show tab-level keytips.
 * - `active && depth >= 1` → `{ state: 'showing', level: 'commands',
 * activeTab }` — the chord buffer has advanced past the leading
 * Alt+letter, so command-level keytips for the active ribbon tab
 * are appropriate.
 *
 * The pre- `'awaiting'` state was a presentation concern keyed off
 * the wrong layer; the coordinator's chord matcher now buffers
 * candidate shortcuts directly, so the overlay simply renders the
 * command-level keytips for the active tab and the matcher does the
 * filtering at dispatch time.
 */
function projectChordSnapshotToKeyTipMode(
  snapshot: { active: boolean; depth: number },
  activeRibbonTab: string,
): KeyTipMode {
  if (!snapshot.active) {
    return { state: 'inactive' };
  }
  if (snapshot.depth === 0) {
    return { state: 'showing', level: 'tabs' };
  }
  return { state: 'showing', level: 'commands', activeTab: activeRibbonTab };
}

/**
 * KeyTipProvider (display-only).
 *
 * Subscribes to the coordinator's chord state and exposes it to
 * descendants via context. The coordinator owns the state machine;
 * this provider is a passive read-through.
 */
export function KeyTipProvider({ children }: KeyTipProviderProps): React.JSX.Element {
  const snapshot = useChordModeSnapshot();
  const uiStoreApi = useUIStoreApi();
  const activeRibbonTab = useStore(uiStoreApi, (s) => s.activeRibbonTab);

  const mode = useMemo<KeyTipMode>(
    () => projectChordSnapshotToKeyTipMode(snapshot, activeRibbonTab),
    [snapshot, activeRibbonTab],
  );

  const value = useMemo<KeyTipContextValue>(() => ({ mode }), [mode]);

  return <KeyTipContext.Provider value={value}>{children}</KeyTipContext.Provider>;
}
