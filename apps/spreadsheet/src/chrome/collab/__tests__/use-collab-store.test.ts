import { useCollabStore } from '../use-collab-store';
import type {
  CollaborationPresenceState as PresenceState,
  CollaborationSidecar as WsSidecar,
  CollaborationSidecarStatus as SidecarStatus,
} from '@mog-sdk/kernel';

// ---------------------------------------------------------------------------
// Mock sidecar factory
// ---------------------------------------------------------------------------

interface MockSidecar extends WsSidecar {
  _statusListeners: Set<(s: SidecarStatus) => void>;
  _presenceListeners: Set<(p: ReadonlyMap<string, PresenceState>) => void>;
  _detached: boolean;
  _presenceData: PresenceState[];
  /** Simulate a status change from outside */
  _emitStatus(s: SidecarStatus): void;
  /** Simulate a presence change from outside */
  _emitPresence(p: ReadonlyMap<string, PresenceState>): void;
}

function createMockSidecar(opts?: {
  initialStatus?: SidecarStatus;
  initialParticipants?: ReadonlyMap<string, PresenceState>;
}): MockSidecar {
  const statusListeners = new Set<(s: SidecarStatus) => void>();
  const presenceListeners = new Set<(p: ReadonlyMap<string, PresenceState>) => void>();
  let currentStatus: SidecarStatus = opts?.initialStatus ?? 'online';
  const currentParticipants = opts?.initialParticipants ?? new Map();

  const sidecar: MockSidecar = {
    get status() {
      return currentStatus;
    },
    get participants() {
      return currentParticipants;
    },
    _statusListeners: statusListeners,
    _presenceListeners: presenceListeners,
    _detached: false,
    _presenceData: [],

    onStatusChange(cb) {
      statusListeners.add(cb);
      cb(currentStatus); // replay, same as real sidecar
      return () => {
        statusListeners.delete(cb);
      };
    },

    onPresenceChange(cb) {
      presenceListeners.add(cb);
      if (currentParticipants.size > 0) {
        cb(currentParticipants);
      }
      return () => {
        presenceListeners.delete(cb);
      };
    },

    setPresence(state) {
      sidecar._presenceData.push(state);
    },

    detach() {
      sidecar._detached = true;
      currentStatus = 'offline';
      for (const cb of statusListeners) cb('offline');
    },

    _emitStatus(s) {
      currentStatus = s;
      for (const cb of statusListeners) cb(s);
    },

    _emitPresence(p) {
      for (const cb of presenceListeners) cb(p);
    },
  };

  return sidecar;
}

// ---------------------------------------------------------------------------
// Reset store between tests
// ---------------------------------------------------------------------------

function resetStore() {
  useCollabStore.setState({
    enabled: false,
    connecting: false,
    sidecar: null,
    config: null,
    roomId: null,
    status: null,
    participants: new Map(),
    _cleanup: null,
  });
}

beforeEach(() => {
  resetStore();
  // Seed config so identity broadcast works
  useCollabStore.getState().setConfig({
    baseUrl: 'ws://test:4100',
    user: { userId: 'user-1', displayName: 'Alice' },
  });
});

// ---------------------------------------------------------------------------
// activateCollabSession
// ---------------------------------------------------------------------------

describe('activateCollabSession', () => {
  it('sets all session fields atomically', () => {
    const sidecar = createMockSidecar({ initialStatus: 'online' });

    useCollabStore.getState().activateCollabSession(sidecar, 'room-1');

    const state = useCollabStore.getState();
    expect(state.enabled).toBe(true);
    expect(state.connecting).toBe(false);
    expect(state.sidecar).toBe(sidecar);
    expect(state.roomId).toBe('room-1');
    expect(state.status).toBe('online');
    expect(state.participants).toBeInstanceOf(Map);
  });

  it('creates exactly one status and one presence subscription', () => {
    const sidecar = createMockSidecar();

    useCollabStore.getState().activateCollabSession(sidecar, 'room-1');

    // 1 listener each (the replay during subscribe is synchronous and doesn't add more)
    expect(sidecar._statusListeners.size).toBe(1);
    expect(sidecar._presenceListeners.size).toBe(1);
  });

  it('broadcasts identity immediately (C5)', () => {
    const sidecar = createMockSidecar();

    useCollabStore.getState().activateCollabSession(sidecar, 'room-1');

    expect(sidecar._presenceData.length).toBeGreaterThanOrEqual(1);
    const broadcast = sidecar._presenceData[0];
    expect(broadcast.displayName).toBe('Alice');
    expect(broadcast.color).toBeTruthy();
  });

  it('guards against double-activation (C8) - cleans up prior UI session', () => {
    const sidecar1 = createMockSidecar();
    const sidecar2 = createMockSidecar();

    useCollabStore.getState().activateCollabSession(sidecar1, 'room-1');
    useCollabStore.getState().activateCollabSession(sidecar2, 'room-2');

    // First sidecar should stay transport-owned by shell but lose UI listeners.
    expect(sidecar1._detached).toBe(false);
    expect(sidecar1._statusListeners.size).toBe(0);
    expect(sidecar1._presenceListeners.size).toBe(0);

    // Second sidecar is now active
    const state = useCollabStore.getState();
    expect(state.sidecar).toBe(sidecar2);
    expect(state.roomId).toBe('room-2');
    expect(sidecar2._statusListeners.size).toBe(1);
  });

  it('sets connecting to false (C9)', () => {
    useCollabStore.setState({ connecting: true });
    const sidecar = createMockSidecar();

    useCollabStore.getState().activateCollabSession(sidecar, 'room-1');

    expect(useCollabStore.getState().connecting).toBe(false);
  });

  it('re-broadcasts identity on reconnect (C5)', () => {
    const sidecar = createMockSidecar();
    useCollabStore.getState().activateCollabSession(sidecar, 'room-1');

    const initialBroadcasts = sidecar._presenceData.length;

    // Simulate reconnect
    sidecar._emitStatus('reconnecting');
    sidecar._emitStatus('online');

    expect(sidecar._presenceData.length).toBe(initialBroadcasts + 1);
    expect(sidecar._presenceData[sidecar._presenceData.length - 1].displayName).toBe('Alice');
  });

  it('propagates presence updates to store', () => {
    const sidecar = createMockSidecar();
    useCollabStore.getState().activateCollabSession(sidecar, 'room-1');

    const newParticipants = new Map<string, PresenceState>([
      ['peer-1', { displayName: 'Bob', color: '#ff0000' }],
    ]);
    sidecar._emitPresence(newParticipants);

    expect(useCollabStore.getState().participants.size).toBe(1);
    expect(useCollabStore.getState().participants.get('peer-1')?.displayName).toBe('Bob');
  });
});

// ---------------------------------------------------------------------------
// deactivateCollabSession
// ---------------------------------------------------------------------------

describe('deactivateCollabSession', () => {
  it('resets all session fields', () => {
    const sidecar = createMockSidecar();
    useCollabStore.getState().activateCollabSession(sidecar, 'room-1');

    useCollabStore.getState().deactivateCollabSession();

    const state = useCollabStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.connecting).toBe(false);
    expect(state.sidecar).toBeNull();
    expect(state.roomId).toBeNull();
    expect(state.status).toBeNull();
    expect(state.participants.size).toBe(0);
    expect(state._cleanup).toBeNull();
  });

  it('does not detach the shell-owned sidecar', () => {
    const sidecar = createMockSidecar();
    useCollabStore.getState().activateCollabSession(sidecar, 'room-1');

    useCollabStore.getState().deactivateCollabSession();

    expect(sidecar._detached).toBe(false);
  });

  it('removes subscriptions without changing transport status', () => {
    const sidecar = createMockSidecar();
    useCollabStore.getState().activateCollabSession(sidecar, 'room-1');

    useCollabStore.getState().deactivateCollabSession();

    expect(sidecar._statusListeners.size).toBe(0);
    expect(sidecar._presenceListeners.size).toBe(0);
    expect(useCollabStore.getState().status).toBeNull();
  });

  it('is idempotent — safe to call when no session is active', () => {
    expect(() => {
      useCollabStore.getState().deactivateCollabSession();
    }).not.toThrow();

    expect(useCollabStore.getState().enabled).toBe(false);
    expect(useCollabStore.getState().sidecar).toBeNull();
  });

  it('prevents stale subscription callbacks after deactivation', () => {
    const sidecar = createMockSidecar();
    useCollabStore.getState().activateCollabSession(sidecar, 'room-1');
    useCollabStore.getState().deactivateCollabSession();

    // Simulate events on the old sidecar — should not affect store
    // (listeners are removed, and sidecar ref is cleared)
    sidecar._emitPresence(new Map([['ghost', { displayName: 'Ghost', color: '#000' }]]));

    expect(useCollabStore.getState().participants.size).toBe(0);
  });
});
