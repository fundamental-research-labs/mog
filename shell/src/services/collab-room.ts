export interface CollabRoomConfig {
  url: string;
  roomId: string;
  participantId: string;
}

export interface CollabUserIdentity {
  userId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface CollabConfig {
  /** WebSocket server base URL (e.g. "wss://collab.shortcut.com") */
  baseUrl: string;

  /**
   * Room ID resolver. Given a fileId, returns the room ID to join.
   * Default: (fileId) => `file-${fileId}`
   */
  resolveRoomId?: (fileId: string) => string;

  /** Current user identity for presence indicators. */
  user: CollabUserIdentity;
}

/**
 * Resolve collab room config for a file.
 * Pure function — no env var coupling. Returns null when collabUrl is not provided.
 *
 * @param roomId - Optional room ID override. When provided, used as-is instead
 *   of the default `file-${fileId}` convention. This lets the consumer (e.g.
 *   Shortcut) key rooms to their own identifiers (file_thread_id, share link, etc.).
 */
export function resolveCollabRoom(
  fileId: string,
  userId: string,
  collabUrl: string | undefined,
  roomId?: string,
): CollabRoomConfig | null {
  if (!collabUrl) return null;
  return {
    url: collabUrl,
    roomId: roomId ?? `file-${fileId}`,
    participantId: userId,
  };
}
