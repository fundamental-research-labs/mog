import { isDev } from '@mog/env';
import type {
  CollaborationPresenceState as PresenceState,
  CollaborationSidecar as WsSidecar,
  CollaborationSidecarStatus as SidecarStatus,
} from '@mog-sdk/kernel';
import type { CollabConfig } from '@mog/shell';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Identity helpers (used by activateCollabSession for C5 broadcast)
// ---------------------------------------------------------------------------

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

function getPresenceColor(userId: string): string {
  return PRESENCE_COLORS[hashCode(userId) % PRESENCE_COLORS.length];
}

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

interface CollabStoreState {
  // --- Session state (set atomically by activate/deactivate) ---
  enabled: boolean;
  connecting: boolean;
  sidecar: WsSidecar | null;
  config: CollabConfig | null;
  roomId: string | null;
  status: SidecarStatus | null;
  participants: ReadonlyMap<string, PresenceState>;

  // --- Internal (not exposed to consumers) ---
  /** Cleanup function for the active session's subscriptions + beforeunload. */
  _cleanup: (() => void) | null;

  // --- Actions ---
  toggle: () => void;
  setConnecting: (v: boolean) => void;
  setConfig: (config: CollabConfig | null) => void;

  /**
   * Atomically activate a collab session. C1, C2, C5, C6, C7, C8, C9.
   *
   * - Guards against double-activation (C8)
   * - Reads sidecar state BEFORE subscribing to avoid replay noise (C1)
   * - Sets all fields in a single set() call including connecting: false (C9)
   * - Broadcasts identity immediately (C5)
   * - Stores cleanup for deactivateCollabSession (C6)
   */
  activateCollabSession: (sidecar: WsSidecar, roomId: string) => void;

  /**
   * Atomically deactivate the collab session. C6.
   *
   * Ordering: unsub → reset store. Transport lifecycle is owned by shell.
   * Idempotent — safe to call when no session is active.
   */
  deactivateCollabSession: () => void;

  // --- Legacy setters (retained for config; others are deprecated) ---
  setEnabled: (v: boolean) => void;
  setRoomId: (roomId: string | null) => void;
  setStatus: (status: SidecarStatus | null) => void;
  setParticipants: (participants: ReadonlyMap<string, PresenceState>) => void;
}

// ---------------------------------------------------------------------------
// Dev-mode invariant assertions (C1 enforcement)
// ---------------------------------------------------------------------------

function assertInvariants(state: CollabStoreState, label: string): void {
  if (!isDev()) return;

  // If sidecar is non-null, enabled must be true
  if (state.sidecar !== null && !state.enabled) {
    console.error(
      `[Collab:Invariant] VIOLATED at "${label}": sidecar !== null but enabled === false`,
      { sidecar: !!state.sidecar, enabled: state.enabled, connecting: state.connecting },
    );
  }

  // If enabled is true and not in connecting phase, sidecar must be non-null
  if (state.enabled && !state.connecting && state.sidecar === null) {
    console.error(
      `[Collab:Invariant] VIOLATED at "${label}": enabled === true, connecting === false, but sidecar === null`,
      { enabled: state.enabled, connecting: state.connecting, sidecar: state.sidecar },
    );
  }

  // If disabled, status and participants should be cleared
  if (!state.enabled && (state.status !== null || state.participants.size > 0)) {
    console.error(
      `[Collab:Invariant] VIOLATED at "${label}": enabled === false but status/participants not cleared`,
      { enabled: state.enabled, status: state.status, participants: state.participants.size },
    );
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCollabStore = create<CollabStoreState>()(
  persist(
    (set, get) => ({
      enabled: false,
      connecting: false,
      sidecar: null,
      config: null,
      roomId: null,
      status: null,
      participants: new Map(),
      _cleanup: null,

      toggle: () => set((s) => ({ enabled: !s.enabled })),

      setConnecting: (v) => {
        console.log(`[Collab:Store] setConnecting(${v})`);
        set({ connecting: v });
      },
      setConfig: (config) => {
        console.log(
          `[Collab:Store] setConfig(baseUrl=${config?.baseUrl}, userId=${config?.user.userId})`,
        );
        set({ config });
      },

      // Legacy setters — kept for backward compat during migration, but
      // callers should use activateCollabSession/deactivateCollabSession.
      setEnabled: (v) => {
        console.log(
          `[Collab:Store] setEnabled(${v}) [DEPRECATED — use activate/deactivateCollabSession]`,
        );
        set({ enabled: v });
      },
      setRoomId: (roomId) => {
        console.log(`[Collab:Store] setRoomId(${roomId}) [DEPRECATED]`);
        set({ roomId });
      },
      setStatus: (status) => {
        console.log(`[Collab:Store] setStatus(${status})`);
        set({ status });
      },
      setParticipants: (participants) => {
        console.log(`[Collab:Store] setParticipants(count=${participants.size})`);
        set({ participants });
      },

      activateCollabSession: (sidecar, roomId) => {
        const state = get();

        // C8: Double-activation guard — clean up prior session first
        if (state.sidecar !== null) {
          console.log(
            '[Collab:Store] activateCollabSession — double-activation guard, deactivating prior session',
          );
          get().deactivateCollabSession();
        }

        const config = get().config;

        // C1: Read sidecar state BEFORE subscribing.
        // The sidecar's onStatusChange/onPresenceChange replay current state
        // to new subscribers synchronously. By reading first and including
        // values in the atomic set(), the replays become no-ops.
        const initialStatus = sidecar.status;
        const initialParticipants = new Map<string, PresenceState>(sidecar.participants);

        // C1 + C9: Single atomic set() — no intermediate renders
        console.log(
          `[Collab:Store] activateCollabSession roomId=${roomId} status=${initialStatus} participants=${initialParticipants.size}`,
        );
        set({
          sidecar,
          roomId,
          enabled: true,
          connecting: false, // C9
          status: initialStatus,
          participants: initialParticipants,
        });

        // C5: Broadcast identity immediately
        const userId = config?.user.userId;
        const displayName = config?.user.displayName ?? 'Anonymous';
        const avatarUrl = config?.user.avatarUrl;
        if (userId) {
          console.log(
            `[Collab:Store] broadcasting identity userId=${userId} displayName=${displayName}`,
          );
          sidecar.setPresence({
            displayName,
            color: getPresenceColor(userId),
            avatarUrl,
          });
        }

        // C2: Single subscription point
        const unsubStatus = sidecar.onStatusChange((s) => {
          console.log(`[Collab:Store] onStatusChange: ${s}`);
          get().setStatus(s);

          // C5: Re-broadcast identity on reconnect
          if (s === 'online' && userId) {
            console.log(`[Collab:Store] re-broadcasting identity on reconnect`);
            sidecar.setPresence({
              displayName,
              color: getPresenceColor(userId),
              avatarUrl,
            });
          }
        });

        const unsubPresence = sidecar.onPresenceChange((p) => {
          get().setParticipants(new Map(p));
        });

        // C6: Store cleanup function
        const cleanup = () => {
          unsubStatus();
          unsubPresence();
        };
        set({ _cleanup: cleanup });

        // Dev-mode invariant check
        assertInvariants(get(), 'activateCollabSession');
      },

      deactivateCollabSession: () => {
        const state = get();
        if (!state.sidecar && !state.enabled) {
          // Already deactivated — idempotent
          return;
        }

        console.log('[Collab:Store] deactivateCollabSession');

        // C6 ordering: unsub first, then reset. Transport detach/flush is owned by shell.
        state._cleanup?.();

        // Single atomic reset
        set({
          sidecar: null,
          enabled: false,
          connecting: false,
          roomId: null,
          status: null,
          participants: new Map(),
          _cleanup: null,
        });

        // Dev-mode invariant check
        assertInvariants(get(), 'deactivateCollabSession');
      },
    }),
    {
      name: 'mog:collab-enabled',
      partialize: (s) => ({ enabled: s.enabled }),
    },
  ),
);

// Expose for E2E testing (devtools / app-eval)
if (typeof window !== 'undefined') {
  (window as any).__COLLAB_STORE__ = useCollabStore;
}
