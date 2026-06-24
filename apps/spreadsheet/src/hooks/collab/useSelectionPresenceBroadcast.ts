import { useEffect, useRef } from 'react';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { CollaborationPresenceState as PresenceState } from '@mog-sdk/kernel';
import { useActiveSheetId } from '../../infra/context';
import { useCollabStore } from '../../chrome/collab/use-collab-store';

const PRESENCE_BROADCAST_INTERVAL_MS = 100;

type PresencePayload = Omit<PresenceState, 'displayName' | 'color' | 'avatarUrl'>;

/**
 * Subscribes to the coordinator's selection actor and broadcasts
 * selection changes via collab presence. Throttled to 100ms to
 * avoid flooding the WebSocket.
 *
 * No setTimeout — the effect fires reactively when the sidecar
 * transitions from null to a value in the Zustand store.
 */
export function useSelectionPresenceBroadcast(
  setPresence: (state: PresencePayload) => void,
  coordinator: any,
): void {
  const activeSheetId = useActiveSheetId();
  const sidecar = useCollabStore((s) => s.sidecar);
  const lastBroadcastRef = useRef(0);
  const trailingBroadcastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a stable ref to setPresence so the subscription closure
  // always calls the latest version
  const setPresenceRef = useRef(setPresence);
  setPresenceRef.current = setPresence;

  useEffect(() => {
    if (!coordinator || !sidecar) return;

    const selectionActor = coordinator.grid?.access?.actors?.selection;
    if (!selectionActor) return;
    const editorActor = coordinator.grid?.access?.actors?.editor;

    const buildPresencePayload = (): PresencePayload | null => {
      const selection = coordinator.grid?.getSelectionSnapshot?.();
      const activeCell = selection?.activeCell;
      if (!activeCell) return null;

      const range = selection.ranges?.[0];
      const ranges = selection.ranges?.map((item: CellRange) => ({
        startRow: Math.min(item.startRow, item.endRow),
        startCol: Math.min(item.startCol, item.endCol),
        endRow: Math.max(item.startRow, item.endRow),
        endCol: Math.max(item.startCol, item.endCol),
      }));
      const startRow = range ? Math.min(range.startRow, range.endRow) : activeCell.row;
      const startCol = range ? Math.min(range.startCol, range.endCol) : activeCell.col;
      const endRow = range ? Math.max(range.startRow, range.endRow) : activeCell.row;
      const endCol = range ? Math.max(range.startCol, range.endCol) : activeCell.col;

      const editor = coordinator.grid?.getEditorSnapshot?.();
      const editingCell = editor?.isEditing ? editor.editingCell : null;
      return {
        selection: {
          sheetId: activeSheetId,
          row: activeCell.row,
          col: activeCell.col,
          startRow,
          startCol,
          endRow,
          endCol,
          ...(ranges?.length ? { ranges } : {}),
        },
        ...(editingCell
          ? {
              editing: {
                sheetId: editor.sheetId ?? activeSheetId,
                row: editingCell.row,
                col: editingCell.col,
              },
            }
          : {}),
      };
    };

    const broadcastPresence = () => {
      const payload = buildPresencePayload();
      if (!payload) return;
      setPresenceRef.current(payload);
      lastBroadcastRef.current = Date.now();
    };

    const scheduleBroadcast = () => {
      const elapsed = Date.now() - lastBroadcastRef.current;
      if (elapsed >= PRESENCE_BROADCAST_INTERVAL_MS) {
        if (trailingBroadcastRef.current) {
          clearTimeout(trailingBroadcastRef.current);
          trailingBroadcastRef.current = null;
        }
        broadcastPresence();
        return;
      }

      if (trailingBroadcastRef.current) return;
      trailingBroadcastRef.current = setTimeout(() => {
        trailingBroadcastRef.current = null;
        broadcastPresence();
      }, PRESENCE_BROADCAST_INTERVAL_MS - elapsed);
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
      broadcastPresence();
    }

    const selectionSub = selectionActor.subscribe(scheduleBroadcast);
    const editorSub = editorActor?.subscribe?.(scheduleBroadcast);

    return () => {
      if (trailingBroadcastRef.current) {
        clearTimeout(trailingBroadcastRef.current);
        trailingBroadcastRef.current = null;
      }
      selectionSub.unsubscribe();
      editorSub?.unsubscribe?.();
    };
  }, [coordinator, activeSheetId, sidecar]);
}
