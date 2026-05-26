import { useMemo } from 'react';
import { useCollabStore } from '../../chrome/collab/use-collab-store';
import { PRESENCE_COLORS } from '../../chrome/collab/presence-colors';
import type { CollaborationPresenceState as PresenceState } from '@mog-sdk/kernel';
import type { RemoteCursor } from '@mog-sdk/contracts/rendering';

const EMPTY: RemoteCursor[] = [];

/**
 * Convert a sidecar PresenceState map into RemoteCursor[] for the renderer.
 * The sidecar already filters out the local participant, so all entries are remote.
 * Colors are assigned by participant index to guarantee each cursor gets a distinct color.
 */
function presenceToRemoteCursors(participants: ReadonlyMap<string, PresenceState>): RemoteCursor[] {
  const cursors: RemoteCursor[] = [];
  let clientId = 0;
  for (const [participantId, state] of participants) {
    if (!state.selection) continue;

    const sel = state.selection;
    const color = PRESENCE_COLORS[clientId % PRESENCE_COLORS.length];
    cursors.push({
      clientId: clientId++,
      user: {
        id: participantId,
        name: state.displayName,
        color,
        avatar: state.avatarUrl,
      },
      activeCell: { row: sel.row, col: sel.col },
      selection:
        sel.endRow != null && sel.endCol != null
          ? [{ startRow: sel.row, startCol: sel.col, endRow: sel.endRow, endCol: sel.endCol }]
          : [{ startRow: sel.row, startCol: sel.col, endRow: sel.row, endCol: sel.col }],
      sheetId: sel.sheetId,
      isEditing: !!state.editing,
      editingCell: state.editing ? { row: state.editing.row, col: state.editing.col } : undefined,
    });
  }
  return cursors;
}

/**
 * Hook that returns RemoteCursor[] for the renderer's collaboration layer.
 *
 * Pure Zustand selector + useMemo — no effects, no subscriptions, no shell access.
 * Participants are kept in sync by activateCollabSession's centralized subscriptions.
 */
export function useRemoteCursors(): RemoteCursor[] {
  const participants = useCollabStore((s) => s.participants);

  return useMemo(() => {
    if (participants.size === 0) return EMPTY;
    return presenceToRemoteCursors(participants);
  }, [participants]);
}
