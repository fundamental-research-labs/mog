import { useCollabStore } from '../../chrome/collab/use-collab-store';
import type {
  CollaborationPresenceState as PresenceState,
  CollaborationSidecarStatus as SidecarStatus,
} from '@mog-sdk/kernel';
import { useCallback } from 'react';

/** 8 visually distinct, accessible colors. Assigned by hash(userId) % 8. */
const PRESENCE_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
] as const;

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getPresenceColor(userId: string): string {
  return PRESENCE_COLORS[hashCode(userId) % PRESENCE_COLORS.length];
}

export interface CollabPresenceResult {
  participants: ReadonlyMap<string, PresenceState>;
  status: SidecarStatus | null;
  setPresence: (state: Omit<PresenceState, 'displayName' | 'color' | 'avatarUrl'>) => void;
}

/**
 * React hook that exposes collab presence state.
 *
 * All presence data flows through Zustand — no sidecar refs, no shell access,
 * no subscriptions. Identity broadcast is handled by activateCollabSession (C5).
 *
 * setPresence reads the sidecar from the store imperatively (getState()) to
 * avoid stale closures — this is the correct pattern for write-through access.
 */
export function useCollabPresence(): CollabPresenceResult {
  const config = useCollabStore((s) => s.config);
  const participants = useCollabStore((s) => s.participants);
  const status = useCollabStore((s) => s.status);

  const userId = config?.user.userId ?? null;
  const displayName = config?.user.displayName ?? 'Anonymous';
  const avatarUrl = config?.user.avatarUrl;

  const setPresence = useCallback(
    (state: Omit<PresenceState, 'displayName' | 'color' | 'avatarUrl'>) => {
      const sidecar = useCollabStore.getState().sidecar;
      if (!sidecar || !userId) return;

      sidecar.setPresence({
        ...state,
        displayName,
        color: getPresenceColor(userId),
        avatarUrl,
      });
    },
    [userId, displayName, avatarUrl],
  );

  return {
    participants,
    status,
    setPresence,
  };
}
