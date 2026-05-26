import type {
  CellSnapshotData,
  DevToolsStatus,
  MachineSnapshot,
  SceneGraphSnapshotData,
  StoreEntry,
  ViewportSnapshotData,
} from '../types';
import type { DevToolsReceiver } from './broadcast-channel';

type StoreListener = () => void;

/**
 * The DevTools window's local mirror of the main window's EventStore.
 * Receives data via BroadcastChannel and exposes the subset of the
 * console API that the DevToolsPanel UI needs.
 */
export class RemoteEventStore {
  private events: StoreEntry[] = [];
  private machines: Record<string, MachineSnapshot> = {};
  private _connected = false;
  private _recording = false;
  private _viewportSnapshot: ViewportSnapshotData | null = null;
  private _scenegraphSnapshot: SceneGraphSnapshotData | null = null;
  private _cellSnapshot: CellSnapshotData | null = null;

  private listeners = new Set<StoreListener>();
  private rafPending = false;
  private _version = 0;
  private _cachedStatus: DevToolsStatus | null = null;
  private _cachedStatusVersion = -1;
  private _cachedJSON: { events: StoreEntry[]; machines: Record<string, MachineSnapshot> } | null =
    null;
  private _cachedJSONVersion = -1;

  private readonly receiver: DevToolsReceiver;

  constructor(receiver: DevToolsReceiver) {
    this.receiver = receiver;

    this.receiver.onMessage((msg) => {
      switch (msg.type) {
        case 'event':
          this.events.push(msg.payload);
          this.notify();
          break;

        case 'snapshot':
          this.events = msg.payload.events;
          this.machines = msg.payload.machines;
          this._connected = true;
          this.notify();
          break;

        case 'clear':
          this.events = [];
          this.machines = {};
          this.notify();
          break;

        case 'status-update':
          this._recording = msg.payload.recording;
          this.notify();
          break;

        case 'viewport-snapshot':
          this._viewportSnapshot = msg.payload;
          this.notify();
          break;

        case 'scenegraph-snapshot':
          this._scenegraphSnapshot = msg.payload;
          this.notify();
          break;

        case 'cell-snapshot':
          this._cellSnapshot = msg.payload;
          this.notify();
          break;
      }
    });
  }

  /** Subscribe to store changes. Returns unsubscribe function. */
  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Monotonically increasing version -- bumped on every mutation. */
  get version(): number {
    return this._version;
  }

  /** Notify listeners, coalesced to one call per animation frame. */
  private notify(): void {
    this._version++;
    if (this.rafPending) return;
    this.rafPending = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        this.rafPending = false;
        for (const listener of this.listeners) listener();
      });
    } else {
      // SSR / test fallback
      this.rafPending = false;
      for (const listener of this.listeners) listener();
    }
  }

  /** Request a full snapshot from the main window. */
  connect(): void {
    this.receiver.requestSnapshot();
  }

  getStatus(): DevToolsStatus {
    // Return cached status if version hasn't changed (required by useSyncExternalStore)
    if (this._cachedStatus !== null && this._cachedStatusVersion === this._version) {
      return this._cachedStatus;
    }

    // Compute most fields from local state; only recording comes from main window
    const SLOW_THRESHOLD = 16;
    let slowCount = 0;
    for (const entry of this.events) {
      const evt = entry.event;
      if (
        (evt.type === 'bridge' && evt.durationMs >= SLOW_THRESHOLD) ||
        (evt.type === 'render' && evt.actualDurationMs >= SLOW_THRESHOLD) ||
        (evt.type === 'canvas' && evt.totalMs >= SLOW_THRESHOLD)
      ) {
        slowCount++;
      }
    }

    const machines: DevToolsStatus['machines'] = [];
    for (const [id, m] of Object.entries(this.machines)) {
      machines.push({
        id,
        state: m.currentState,
        eventCount: m.eventCount,
        lastTransitionAt: m.lastTransitionAt,
      });
    }

    this._cachedStatus = {
      recording: this._recording,
      eventCount: this.events.length,
      machines,
      slowCount,
    };
    this._cachedStatusVersion = this._version;
    return this._cachedStatus;
  }

  toJSON(): { events: StoreEntry[]; machines: Record<string, MachineSnapshot> } {
    if (this._cachedJSON !== null && this._cachedJSONVersion === this._version) {
      return this._cachedJSON;
    }
    this._cachedJSON = { events: this.events, machines: this.machines };
    this._cachedJSONVersion = this._version;
    return this._cachedJSON;
  }

  enable(): void {
    this.receiver.sendCommand('enable');
  }

  disable(): void {
    this.receiver.sendCommand('disable');
  }

  clear(): void {
    this.receiver.sendCommand('clear');
  }

  requestViewportSnapshot(): void {
    this.receiver.sendMessage({ type: 'request-viewport-snapshot' });
  }

  requestSceneGraphSnapshot(): void {
    this.receiver.sendMessage({ type: 'request-scenegraph-snapshot' });
  }

  requestCellSnapshot(row: number, col: number, viewportId?: string): void {
    this.receiver.sendMessage({ type: 'request-cell-snapshot', payload: { row, col, viewportId } });
  }

  getViewportSnapshot(): ViewportSnapshotData | null {
    return this._viewportSnapshot;
  }

  getSceneGraphSnapshot(): SceneGraphSnapshotData | null {
    return this._scenegraphSnapshot;
  }

  getCellSnapshot(): CellSnapshotData | null {
    return this._cellSnapshot;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  dispose(): void {
    this.listeners.clear();
    this.receiver.dispose();
  }
}
