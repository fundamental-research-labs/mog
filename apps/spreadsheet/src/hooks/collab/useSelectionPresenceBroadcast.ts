import { useEffect, useRef } from 'react';
import type { CollaborationPresenceState as PresenceState } from '@mog-sdk/kernel';
import { useActiveSheetId } from '../../infra/context';
import { useCollabStore } from '../../chrome/collab/use-collab-store';

/**
 * Subscribes to the coordinator's selection actor and broadcasts
 * selection changes via collab presence. Throttled to 100ms to
 * avoid flooding the WebSocket.
 *
 * No setTimeout — the effect fires reactively when the sidecar
 * transitions from null to a value in the Zustand store.
 */
export function useSelectionPresenceBroadcast(
  setPresence: (state: Omit<PresenceState, 'displayName' | 'color' | 'avatarUrl'>) => void,
  coordinator: any,
): void {
  const activeSheetId = useActiveSheetId();
  const sidecar = useCollabStore((s) => s.sidecar);
  const lastBroadcastRef = useRef(0);
  // Keep a stable ref to setPresence so the subscription closure
  // always calls the latest version
  const setPresenceRef = useRef(setPresence);
  setPresenceRef.current = setPresence;

  useEffect(() => {
    if (!coordinator || !sidecar) return;

    const selectionActor = coordinator.grid?.access?.actors?.selection;
    if (!selectionActor) return;

    const broadcastSelection = (state: any) => {
      const ctx = state.context ?? state;
      const { activeCell, ranges } = ctx;
      if (!activeCell) return;

      const range = ranges?.[0];
      setPresenceRef.current({
        selection: {
          sheetId: activeSheetId,
          row: activeCell.row,
          col: activeCell.col,
          ...(range ? { endRow: range.endRow, endCol: range.endCol } : {}),
        },
      });
    };

    // Broadcast the current selection immediately — no setTimeout needed
    // because the sidecar is guaranteed to exist (it's in the effect deps
    // and we checked it above).
    const snapshot = selectionActor.getSnapshot?.();
    if (snapshot) {
      console.log('[Collab:SelectionBroadcast] initial snapshot broadcast', {
        activeCell: snapshot.context?.activeCell ?? snapshot.activeCell ?? null,
        sheetId: activeSheetId,
      });
      broadcastSelection(snapshot);
      lastBroadcastRef.current = Date.now();
    }

    const sub = selectionActor.subscribe((state: any) => {
      const now = Date.now();
      if (now - lastBroadcastRef.current < 100) return;
      lastBroadcastRef.current = now;
      broadcastSelection(state);
    });

    return () => {
      sub.unsubscribe();
    };
  }, [coordinator, activeSheetId, sidecar]);
}
