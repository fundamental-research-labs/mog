import type {
  CellSnapshotData,
  DevToolsStatus,
  MachineSnapshot,
  SceneGraphSnapshotData,
  StoreEntry,
  ViewportSnapshotData,
} from '../types';

// Message types sent from main window -> devtools window
export type MainToDevToolsMessage =
  | { type: 'event'; payload: StoreEntry }
  | {
      type: 'snapshot';
      payload: { events: StoreEntry[]; machines: Record<string, MachineSnapshot> };
    }
  | { type: 'clear' }
  | { type: 'status-update'; payload: DevToolsStatus }
  | { type: 'viewport-snapshot'; payload: ViewportSnapshotData }
  | { type: 'scenegraph-snapshot'; payload: SceneGraphSnapshotData }
  | { type: 'cell-snapshot'; payload: CellSnapshotData };

// Message types sent from devtools window -> main window
export type DevToolsToMainMessage =
  | { type: 'request-snapshot' }
  | { type: 'command'; command: 'enable' | 'disable' | 'clear' }
  | { type: 'request-viewport-snapshot' }
  | { type: 'request-scenegraph-snapshot' }
  | { type: 'request-cell-snapshot'; payload: { row: number; col: number; viewportId?: string } };

export type DevToolsMessage = MainToDevToolsMessage | DevToolsToMainMessage;

const CHANNEL_NAME = 'os-devtools';

/**
 * Used by the main window to broadcast events to the DevTools window
 * and receive commands back.
 */
export class DevToolsBroadcaster {
  private channel: BroadcastChannel;
  private commandHandler: ((msg: DevToolsToMainMessage) => void) | null = null;

  constructor() {
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (ev: MessageEvent<DevToolsMessage>) => {
      const msg = ev.data;
      if (
        msg.type === 'request-snapshot' ||
        msg.type === 'command' ||
        msg.type === 'request-viewport-snapshot' ||
        msg.type === 'request-scenegraph-snapshot' ||
        msg.type === 'request-cell-snapshot'
      ) {
        this.commandHandler?.(msg);
      }
    };
  }

  sendEvent(entry: StoreEntry): void {
    this.channel.postMessage({ type: 'event', payload: entry } satisfies MainToDevToolsMessage);
  }

  sendSnapshot(payload: { events: StoreEntry[]; machines: Record<string, MachineSnapshot> }): void {
    this.channel.postMessage({ type: 'snapshot', payload } satisfies MainToDevToolsMessage);
  }

  sendClear(): void {
    this.channel.postMessage({ type: 'clear' } satisfies MainToDevToolsMessage);
  }

  sendStatusUpdate(status: DevToolsStatus): void {
    this.channel.postMessage({
      type: 'status-update',
      payload: status,
    } satisfies MainToDevToolsMessage);
  }

  sendViewportSnapshot(payload: ViewportSnapshotData): void {
    this.channel.postMessage({
      type: 'viewport-snapshot',
      payload,
    } satisfies MainToDevToolsMessage);
  }

  sendSceneGraphSnapshot(payload: SceneGraphSnapshotData): void {
    this.channel.postMessage({
      type: 'scenegraph-snapshot',
      payload,
    } satisfies MainToDevToolsMessage);
  }

  sendCellSnapshot(payload: CellSnapshotData): void {
    this.channel.postMessage({
      type: 'cell-snapshot',
      payload,
    } satisfies MainToDevToolsMessage);
  }

  onCommand(handler: (msg: DevToolsToMainMessage) => void): void {
    this.commandHandler = handler;
  }

  dispose(): void {
    this.channel.close();
    this.commandHandler = null;
  }
}

/**
 * Used by the DevTools window to receive events from the main window
 * and send commands back.
 */
export class DevToolsReceiver {
  private channel: BroadcastChannel;
  private messageHandler: ((msg: MainToDevToolsMessage) => void) | null = null;

  constructor() {
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (ev: MessageEvent<DevToolsMessage>) => {
      const msg = ev.data;
      if (
        msg.type === 'event' ||
        msg.type === 'snapshot' ||
        msg.type === 'clear' ||
        msg.type === 'status-update' ||
        msg.type === 'viewport-snapshot' ||
        msg.type === 'scenegraph-snapshot' ||
        msg.type === 'cell-snapshot'
      ) {
        this.messageHandler?.(msg);
      }
    };
  }

  onMessage(handler: (msg: MainToDevToolsMessage) => void): void {
    this.messageHandler = handler;
  }

  requestSnapshot(): void {
    this.channel.postMessage({
      type: 'request-snapshot',
    } satisfies DevToolsToMainMessage);
  }

  sendCommand(command: 'enable' | 'disable' | 'clear'): void {
    this.channel.postMessage({ type: 'command', command } satisfies DevToolsToMainMessage);
  }

  sendMessage(msg: DevToolsToMainMessage): void {
    this.channel.postMessage(msg);
  }

  dispose(): void {
    this.channel.close();
    this.messageHandler = null;
  }
}
