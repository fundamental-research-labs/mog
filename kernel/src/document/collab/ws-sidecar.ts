/**
 * WebSocket sidecar that connects a browser-based document's ComputeBridge
 * to the collaboration server.
 *
 * Handles the full lifecycle: connect -> join -> hydrate -> live sync -> reconnect.
 */

import { MSG, encodeJson, encodeBinary, decode, classifySyncUpdateWireSource } from './wire-codec';
import type { EventLog, SidecarEventType } from './event-log';
import { fetchRoomSnapshot, type RoomSnapshot } from './room-snapshot';
import {
  buildSidecarRawSyncProvenance,
  type SidecarRawSyncClassification,
} from './sync-provenance';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { DocumentByteSyncPort } from '../providers/provider';

export { fetchRoomSnapshot, type RoomSnapshot } from './room-snapshot';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ComputeBridgeLike {
  syncStateVector(): Promise<Uint8Array>;
  syncDiff(remoteSv: Uint8Array): Promise<Uint8Array>;
  subscribeUpdateV1(callback: (update: Uint8Array) => void): { unsubscribe: () => void };
}

export interface WsSidecarOptions {
  url: string;
  roomId?: string;
  participantId: string;
  computeBridge: ComputeBridgeLike;
  syncPort: Pick<DocumentByteSyncPort, 'applyClassifiedRawUpdate'>;
  /** State vector returned by the non-mutating room snapshot used to create this document. */
  preflightStateVector?: Uint8Array;
  /** Room epoch returned by the non-mutating room snapshot used to create this document. */
  preflightRoomEpoch?: number;
  /** SHA-256 of the full-state snapshot used for first bootstrap. */
  preflightFullStateHash?: string;
  /** Server lineage token for the full-state snapshot used for first bootstrap. */
  preflightSnapshotToken?: string;
  /** Optional event log for test observability. No overhead when omitted. */
  eventLog?: EventLog;
}

export type SidecarStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

export interface PresenceState {
  displayName: string;
  color: string;
  avatarUrl?: string;
  selection?: {
    sheetId: string;
    ranges?: CellRange[];
    startRow?: number;
    startCol?: number;
    row: number;
    col: number;
    endRow?: number;
    endCol?: number;
  };
  editing?: {
    sheetId: string;
    row: number;
    col: number;
  };
}

export interface WsSidecar {
  readonly status: SidecarStatus;
  /** Present only when eventLog was provided in options. */
  readonly eventLog?: EventLog;
  onStatusChange(cb: (status: SidecarStatus) => void): () => void;

  /** Set local presence state. Sends awareness update to server. */
  setPresence(state: PresenceState): void;

  /** Subscribe to remote presence changes. */
  onPresenceChange(cb: (participants: ReadonlyMap<string, PresenceState>) => void): () => void;

  /** Current remote participants (read-only snapshot). */
  readonly participants: ReadonlyMap<string, PresenceState>;

  detach(): void;
  flushAndDetach?(options?: { readonly timeoutMs?: number }): Promise<void>;
}

export interface FlushableWsSidecar extends WsSidecar {
  flushAndDetach(options?: { readonly timeoutMs?: number }): Promise<void>;
}

export interface SidecarClassifiedRawSyncApplyOptions {
  readonly syncPort: Pick<DocumentByteSyncPort, 'applyClassifiedRawUpdate'>;
  readonly roomId: string;
  readonly update: Uint8Array;
  readonly classification: SidecarRawSyncClassification;
}

export async function applySidecarClassifiedRawSyncUpdate(
  options: SidecarClassifiedRawSyncApplyOptions,
): Promise<void> {
  const payloadHash = await sha256Hex(options.update);
  const provenance = buildSidecarRawSyncProvenance(
    options.roomId,
    payloadHash,
    options.classification,
  );
  await options.syncPort.applyClassifiedRawUpdate(options.update, provenance);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function attachWsSidecar(options: WsSidecarOptions): Promise<WsSidecar> {
  const {
    url,
    roomId = inferRoomIdFromUrl(url),
    participantId,
    computeBridge,
    syncPort,
    eventLog,
    preflightStateVector,
    preflightRoomEpoch,
    preflightFullStateHash,
    preflightSnapshotToken,
  } = options;
  validateRoomId(roomId);

  /** Always emit structured console logs; also push to eventLog when provided. */
  const log: (type: SidecarEventType, detail?: Record<string, unknown>) => void = eventLog
    ? (type, detail) => {
        eventLog.push(type, detail);
        console.log(`[Collab:Sidecar] ${type}`, detail ?? '');
      }
    : (type, detail) => {
        console.log(`[Collab:Sidecar] ${type}`, detail ?? '');
      };

  let status: SidecarStatus = 'connecting';
  const statusListeners = new Set<(s: SidecarStatus) => void>();
  const presenceListeners = new Set<(p: ReadonlyMap<string, PresenceState>) => void>();
  const participants = new Map<string, PresenceState>();
  let presenceDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPresence: PresenceState | null = null;
  let ws: WebSocket | null = null;
  let updateSub: { unsubscribe: () => void } | null = null;
  let flushInProgress = false;
  let flushRequested = false;
  let bootstrapComplete = false;
  let detached = false;
  let backoff = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingPushResponses = new Map<
    string,
    {
      resolve: () => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  // Serial queue to prevent concurrent inbound sync applies.
  let applyChain: Promise<void> = Promise.resolve();

  // Last SV we sent to the server (from JOINs and PUSHes).
  // Used to compute outbound diffs.
  let lastServerSv: Uint8Array = new Uint8Array(0);

  function arrEq(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function setStatus(s: SidecarStatus) {
    if (status === s) return;
    const prev = status;
    status = s;
    log('status_change', { from: prev, to: s });
    statusListeners.forEach((cb) => {
      try {
        cb(s);
      } catch {
        /* listener errors are swallowed */
      }
    });
  }

  function notifyPresenceListeners() {
    log('presence_notify', {
      listenerCount: presenceListeners.size,
      participantCount: participants.size,
    });
    presenceListeners.forEach((cb) => {
      try {
        cb(participants);
      } catch (err) {
        log('presence_notify_error', { error: String(err) });
      }
    });
  }

  /** Parse awareness update bytes and update participants map. */
  function applyAwarenessUpdate(data: Uint8Array) {
    try {
      const text = new TextDecoder().decode(data);
      const parsed = JSON.parse(text) as { changes: Record<string, string | null> };
      if (!parsed.changes) return;

      log('awareness_recv', {
        pids: Object.keys(parsed.changes),
        localPid: participantId,
      });

      for (const [pid, state] of Object.entries(parsed.changes)) {
        // Skip our own presence
        if (pid === participantId) {
          log('awareness_skip_self', { pid });
          continue;
        }
        if (state === null) {
          participants.delete(pid);
          log('awareness_remove', { pid });
        } else {
          try {
            const parsed_ = JSON.parse(state) as PresenceState;
            participants.set(pid, parsed_);
            log('awareness_set', {
              pid,
              displayName: parsed_.displayName,
              selection: parsed_.selection ?? null,
            });
          } catch {
            // Invalid JSON state — skip
          }
        }
      }
      if (participants.size > 0) {
      }
      notifyPresenceListeners();
    } catch {
      // Malformed awareness data — ignore
    }
  }

  /** Send current pending presence over WS. */
  function flushPresence() {
    if (!pendingPresence || !ws || ws.readyState !== WebSocket.OPEN) {
      log('flush_presence_skip', {
        hasPending: !!pendingPresence,
        hasWs: !!ws,
        wsState: ws?.readyState ?? -1,
      });
      return;
    }

    const stateJson = JSON.stringify(pendingPresence);
    log('flush_presence_send', {
      participantId,
      displayName: pendingPresence.displayName,
      selection: pendingPresence.selection ?? null,
    });
    // Build awareness update in the same JSON wire format the Rust side expects
    const updateObj = { changes: { [participantId]: stateJson } };
    const updateBytes = new TextEncoder().encode(JSON.stringify(updateObj));

    ws.send(encodeBinary(MSG.AWARENESS_UPDATE, { participantId }, updateBytes));

    pendingPresence = null;
  }

  function serialApply(
    update: Uint8Array,
    classification: SidecarRawSyncClassification,
    swallowErrors = true,
  ): Promise<void> {
    const op = applyChain.then(async () => {
      const t0 = performance.now();
      await applyInboundSyncUpdate(update, classification);
      log('sync_apply', {
        bytes: update.length,
        duration_ms: Math.round(performance.now() - t0),
        ok: true,
      });
    });
    const handled = op.then(
      () => undefined,
      (err) => {
        log('sync_apply', { bytes: update.length, ok: false, error: String(err) });
        if (!swallowErrors) {
          throw err;
        }
        // Live sync-apply errors are swallowed — the CRDT will self-heal on the next sync round.
      },
    );
    applyChain = handled.catch(() => undefined);
    return handled;
  }

  async function applyInboundSyncUpdate(
    update: Uint8Array,
    classification: SidecarRawSyncClassification,
  ): Promise<void> {
    await applySidecarClassifiedRawSyncUpdate({
      syncPort,
      roomId,
      update,
      classification,
    });
  }

  function nextPushId(): string {
    return (
      globalThis.crypto?.randomUUID?.() ??
      `push-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }

  function awaitPushResponse(pushId: string, timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingPushResponses.delete(pushId);
        reject(new Error(`Timed out waiting for PUSH_RESPONSE ${pushId}`));
      }, timeoutMs);
      pendingPushResponses.set(pushId, { resolve, reject, timer });
    });
  }

  function settlePushResponse(pushId: string, error?: Error): void {
    const pending = pendingPushResponses.get(pushId);
    if (!pending) return;
    pendingPushResponses.delete(pushId);
    clearTimeout(pending.timer);
    if (error) {
      pending.reject(error);
    } else {
      pending.resolve();
    }
  }

  // -------------------------------------------------------------------------
  // Outbound periodic flush
  // -------------------------------------------------------------------------

  async function flushOutbound(options?: {
    readonly rejectErrors?: boolean;
    readonly pushTimeoutMs?: number;
  }) {
    const rejectErrors = options?.rejectErrors === true;
    if (flushInProgress) {
      flushRequested = true;
      log('flush_skip', { reason: 'in_progress' });
      if (rejectErrors) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('flush_skip', { reason: 'ws_closed' });
      if (rejectErrors) throw new Error('Collaboration socket is not open');
      return;
    }

    flushInProgress = true;
    try {
      // Wait for any in-flight applies to complete.
      await applyChain;

      const localSv = await computeBridge.syncStateVector();

      // If our SV matches what we last told the server, nothing new to push.
      if (arrEq(localSv, lastServerSv)) {
        log('flush_skip', { reason: 'sv_equal' });
        return;
      }

      const t0 = performance.now();
      const diff = await computeBridge.syncDiff(lastServerSv);
      log('sync_diff', {
        remoteSv: `${lastServerSv.length}B`,
        result: `${diff.length}B`,
        duration_ms: Math.round(performance.now() - t0),
      });
      if (diff.length === 0) {
        log('flush_skip', { reason: 'empty_diff' });
        return;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        log('flush_skip', { reason: 'ws_closed' });
        if (rejectErrors) throw new Error('Collaboration socket is not open');
        return;
      }

      log('flush_start', {
        localSv: `${localSv.length}B`,
        lastServerSv: `${lastServerSv.length}B`,
        equal: false,
      });

      const pushId = nextPushId();
      const ack = awaitPushResponse(pushId, options?.pushTimeoutMs);
      try {
        ws.send(
          encodeBinary(MSG.PUSH, { pushId, touchedSheets: [], sv: Array.from(localSv) }, diff),
        );
      } catch (err) {
        settlePushResponse(pushId, err instanceof Error ? err : new Error(String(err)));
        throw err;
      }

      log('flush_push', { pushId, diff: diff.length, sv: `${localSv.length}B` });
      await ack;
    } catch (err) {
      log('flush_error', { error: String(err) });
      if (rejectErrors) {
        throw err;
      }
      // Retry on next periodic tick.
    } finally {
      flushInProgress = false;
      if (flushRequested && !detached && ws && ws.readyState === WebSocket.OPEN) {
        flushRequested = false;
        queueMicrotask(() => {
          void flushOutbound();
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Inbound message handler
  // -------------------------------------------------------------------------

  function handleMessage(event: MessageEvent) {
    const decoded = decode(event.data as ArrayBuffer);

    switch (decoded.type) {
      case MSG.BROADCAST_NUDGE: {
        log('nudge_recv', { serverSv: `${decoded.binary?.length ?? 0}B` });
        computeBridge.syncStateVector().then((sv) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            log('pull_req', { localSv: `${sv.length}B` });
            ws.send(encodeBinary(MSG.PULL_REQUEST, { sv: Array.from(sv) }, new Uint8Array(0)));
          }
        });
        break;
      }

      case MSG.PUSH_RESPONSE: {
        const meta = decoded.json as {
          pushId?: string;
          ok?: boolean;
          coordinatorSv?: number[];
          error?: string;
        };
        log('push_res', {
          pushId: meta.pushId ?? null,
          ok: meta.ok ?? null,
          serverDiff: decoded.binary?.length ?? 0,
        });
        void (async () => {
          try {
            if (meta.ok === false) {
              throw new Error(meta.error ?? 'PUSH rejected');
            }
            if (meta.ok !== true) {
              throw new Error('Malformed PUSH_RESPONSE: missing ok=true');
            }
            if (!meta.pushId || !pendingPushResponses.has(meta.pushId)) {
              throw new Error(
                `Malformed PUSH_RESPONSE: unknown pushId ${meta.pushId ?? '<missing>'}`,
              );
            }
            if (!Array.isArray(meta.coordinatorSv)) {
              throw new Error(`Malformed PUSH_RESPONSE ${meta.pushId}: missing coordinatorSv`);
            }
            if (decoded.binary && decoded.binary.length > 0) {
              await serialApply(
                new Uint8Array(decoded.binary),
                classifySyncUpdateWireSource(decoded.type),
                false,
              );
            }
            lastServerSv = new Uint8Array(meta.coordinatorSv);
            settlePushResponse(meta.pushId);
          } catch (err) {
            if (meta.pushId) {
              settlePushResponse(meta.pushId, err instanceof Error ? err : new Error(String(err)));
            }
          }
        })();
        break;
      }

      case MSG.PULL_RESPONSE: {
        log('pull_res', { diff: decoded.binary?.length ?? 0 });
        if (decoded.binary && decoded.binary.length > 0) {
          serialApply(new Uint8Array(decoded.binary), classifySyncUpdateWireSource(decoded.type));
        }
        break;
      }

      case MSG.AWARENESS_UPDATE: {
        if (decoded.binary && decoded.binary.length > 0) {
          applyAwarenessUpdate(new Uint8Array(decoded.binary));
        }
        break;
      }

      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Connection + handshake
  // -------------------------------------------------------------------------

  function connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      log('ws_connect', { url });
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      ws = socket;

      socket.addEventListener('open', () => {
        if (bootstrapComplete) {
          void computeBridge
            .syncStateVector()
            .then((sv) => {
              log('resume_req', { roomId, participantId, sv: `${sv.length}B` });
              socket.send(
                encodeJson(MSG.RESUME_REQUEST, {
                  roomId,
                  participantId,
                  sv: Array.from(sv),
                }),
              );
            })
            .catch((err) => {
              reject(err instanceof Error ? err : new Error(String(err)));
              socket.close();
            });
          return;
        }

        if (
          preflightRoomEpoch === undefined ||
          !preflightStateVector ||
          !preflightFullStateHash ||
          !preflightSnapshotToken
        ) {
          reject(new Error('Collaboration first join requires host bootstrap snapshot metadata'));
          socket.close();
          return;
        }

        log('join_req', { roomId, participantId });
        socket.send(
          encodeJson(MSG.JOIN_REQUEST, {
            roomId,
            participantId,
            roomEpoch: preflightRoomEpoch,
            sv: Array.from(preflightStateVector),
            fullStateHash: preflightFullStateHash,
            snapshotToken: preflightSnapshotToken,
          }),
        );
      });

      let handshakeComplete = false;

      function onFirstMessage(event: MessageEvent) {
        socket.removeEventListener('message', onFirstMessage);

        try {
          const decoded = decode(event.data as ArrayBuffer);

          const expectedType = bootstrapComplete ? MSG.RESUME_RESPONSE : MSG.JOIN_RESPONSE;
          if (decoded.type !== expectedType) {
            reject(
              new Error(
                `Expected ${bootstrapComplete ? 'RESUME_RESPONSE' : 'JOIN_RESPONSE'}, got type ${decoded.type}`,
              ),
            );
            socket.close();
            return;
          }

          const isResumeHandshake = bootstrapComplete;
          const meta = decoded.json as {
            ok?: boolean;
            roomId?: string;
            error?: string;
            message?: string;
            locks?: unknown;
            participantCount?: number;
            coordinatorSv?: number[];
            awarenessState?: number[];
            roomEpoch?: number;
            fullStateHash?: string;
            snapshotToken?: string;
          };
          if (meta.ok === false) {
            const err = new Error(meta.message ?? meta.error ?? 'Collaboration join rejected');
            err.name =
              meta.error === 'ROOM_CHANGED_REFETCH'
                ? 'CollaborationRoomChangedRefetchError'
                : 'CollaborationJoinRejectedError';
            reject(err);
            socket.close();
            return;
          }
          const fullState = decoded.binary ?? new Uint8Array(0);
          const coordinatorSv = meta.coordinatorSv
            ? new Uint8Array(meta.coordinatorSv)
            : new Uint8Array(0);

          void (async () => {
            if (meta.roomId !== roomId) {
              throw new Error(
                `Collaboration handshake roomId mismatch: expected ${roomId}, got ${meta.roomId ?? '<missing>'}`,
              );
            }
            if (!isResumeHandshake) {
              if (
                meta.roomEpoch !== preflightRoomEpoch ||
                meta.fullStateHash !== preflightFullStateHash ||
                meta.snapshotToken !== preflightSnapshotToken
              ) {
                throw new Error(
                  'Collaboration JOIN_RESPONSE metadata did not match bootstrap snapshot',
                );
              }
              if ((await sha256Hex(new Uint8Array(fullState))) !== preflightFullStateHash) {
                throw new Error('Collaboration JOIN_RESPONSE fullStateHash mismatch');
              }
            }

            // Hydrate awareness from join/resume response after lineage validation.
            if (meta.awarenessState && meta.awarenessState.length > 0) {
              applyAwarenessUpdate(new Uint8Array(meta.awarenessState));
            }

            log(isResumeHandshake ? 'resume_res' : 'join_res', {
              fullState: `${fullState.length}B`,
              coordinatorSv: `${coordinatorSv.length}B`,
              participantCount: meta.participantCount ?? 0,
              roomEpoch: meta.roomEpoch ?? null,
              preflightRoomEpoch: preflightRoomEpoch ?? null,
            });

            lastServerSv = coordinatorSv;

            if (fullState.length > 0) {
              await serialApply(
                new Uint8Array(fullState),
                classifySyncUpdateWireSource(decoded.type),
                false,
              );
            }
          })()
            .then(() => {
              handshakeComplete = true;
              bootstrapComplete = true;

              // Start listening for live inbound messages
              socket.addEventListener('message', handleMessage);

              // Subscribe to local updates — triggers immediate flush attempt
              updateSub = computeBridge.subscribeUpdateV1((update) => {
                log('update_v1', { bytes: update.length });
                flushOutbound();
              });

              setStatus('online');
              backoff = INITIAL_BACKOFF_MS;
              resolve();
            })
            .catch((err) => {
              reject(err);
              socket.close();
            });
        } catch (err) {
          reject(err);
          socket.close();
        }
      }

      socket.addEventListener('message', onFirstMessage);

      socket.addEventListener('close', (ev) => {
        if (!detached) {
          log('ws_close', { code: (ev as CloseEvent).code, reason: (ev as CloseEvent).reason });
        }
        if (!handshakeComplete) {
          if (!detached) {
            reject(new Error('WebSocket closed before handshake completed'));
          }
          return;
        }
        scheduleReconnect();
      });

      socket.addEventListener('error', () => {
        log('ws_error', {});
        if (!handshakeComplete) return;
      });
    });
  }

  // -------------------------------------------------------------------------
  // Reconnection
  // -------------------------------------------------------------------------

  function teardownCurrentConnection() {
    if (updateSub) {
      updateSub.unsubscribe();
      updateSub = null;
    }
    flushInProgress = false;
    flushRequested = false;
    ws = null;
    rejectPendingPushes('WebSocket closed');
  }

  function rejectPendingPushes(reason: string) {
    for (const [pushId, pending] of pendingPushResponses) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`${reason}: ${pushId}`));
    }
    pendingPushResponses.clear();
  }

  async function flushUntilAcked(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      await applyChain;
      const localSv = await computeBridge.syncStateVector();
      if (arrEq(localSv, lastServerSv)) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error('Collaboration final flush timed out');
      }
      await flushOutbound({
        rejectErrors: true,
        pushTimeoutMs: remaining,
      });
    }
  }

  function scheduleReconnect() {
    if (detached) return;

    teardownCurrentConnection();
    setStatus('reconnecting');
    log('reconnect_schedule', { backoff_ms: backoff });

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (detached) return;

      setStatus('connecting');

      try {
        await connect();
      } catch {
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        scheduleReconnect();
      }
    }, backoff);

    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }

  // -------------------------------------------------------------------------
  // Public sidecar object
  // -------------------------------------------------------------------------

  const sidecar: WsSidecar = {
    get status() {
      return status;
    },

    eventLog,

    get participants(): ReadonlyMap<string, PresenceState> {
      return participants;
    },

    onStatusChange(cb: (s: SidecarStatus) => void): () => void {
      statusListeners.add(cb);
      cb(status); // replay current so late subscribers don't miss
      return () => {
        statusListeners.delete(cb);
      };
    },

    onPresenceChange(cb: (p: ReadonlyMap<string, PresenceState>) => void): () => void {
      presenceListeners.add(cb);
      if (participants.size > 0) {
        try {
          cb(participants);
        } catch {
          /* swallowed */
        }
      }
      return () => {
        presenceListeners.delete(cb);
      };
    },

    setPresence(state: PresenceState): void {
      log('setPresence', { displayName: state.displayName, selection: state.selection ?? null });
      pendingPresence = state;
      // Debounce 100ms for rapid selection changes
      if (presenceDebounceTimer) clearTimeout(presenceDebounceTimer);
      presenceDebounceTimer = setTimeout(() => {
        presenceDebounceTimer = null;
        flushPresence();
      }, 100);
    },

    detach() {
      if (detached) return;
      detached = true;
      log('detach', {});

      if (presenceDebounceTimer) {
        clearTimeout(presenceDebounceTimer);
        presenceDebounceTimer = null;
      }

      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      // Save ws ref before teardown (which nulls it)
      const sock = ws;
      teardownCurrentConnection();
      rejectPendingPushes('Sidecar detached');
      if (sock) {
        sock.close();
      }

      setStatus('offline');
    },

    async flushAndDetach(options?: { readonly timeoutMs?: number }): Promise<void> {
      if (detached) return;
      const timeoutMs = options?.timeoutMs ?? 10_000;
      try {
        await flushUntilAcked(timeoutMs);
        sidecar.detach();
      } catch (err) {
        const error = new Error(err instanceof Error ? err.message : String(err));
        error.name = 'CollaborationFinalFlushError';
        throw error;
      }
    },
  };

  return connect().then(() => sidecar);
}

export async function fetchRoomSnapshotForHostBootstrap(
  url: string,
  roomId: string,
  options?: { readonly timeoutMs?: number },
): Promise<RoomSnapshot> {
  return fetchRoomSnapshot(url, roomId, options?.timeoutMs);
}

export function attachHostBootstrapCollaborationSidecar(
  options: WsSidecarOptions & {
    readonly roomId: string;
    readonly preflightStateVector: Uint8Array;
    readonly preflightRoomEpoch: number;
    readonly preflightFullStateHash: string;
    readonly preflightSnapshotToken: string;
  },
): Promise<FlushableWsSidecar> {
  return attachWsSidecar(options) as Promise<FlushableWsSidecar>;
}

function inferRoomIdFromUrl(url: string): string {
  const parsed = new URL(url);
  const finalSegment = parsed.pathname.split('/').filter(Boolean).pop();
  if (!finalSegment) {
    throw new Error('Collaboration room URL must include a room id final path segment');
  }
  const roomId = decodeURIComponent(finalSegment);
  validateRoomId(roomId);
  return roomId;
}

function validateRoomId(roomId: string): void {
  if (!roomId || roomId === '.' || roomId === '..' || /[/?#]/.test(roomId)) {
    throw new Error(`Invalid collaboration room id: ${roomId}`);
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable');
  }
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
