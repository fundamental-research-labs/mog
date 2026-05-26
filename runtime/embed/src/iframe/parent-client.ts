import { TypedEventEmitter } from '../shared/event-emitter';
import {
  type MogEmbedMessage,
  type MogEmbedMessageType,
  SUPPORTED_VERSIONS,
  CorrelationTimeoutError,
  VersionMismatchError,
  createMessage,
  validateMessageEvent,
} from './protocol';

// ---------------------------------------------------------------------------
// Event map
// ---------------------------------------------------------------------------

export interface ParentEventMap extends Record<string, unknown> {
  ready: void;
  error: Error;
  sheetChange: { index: number; name: string };
  selectionChange: { row: number; col: number };
  dirtyChange: boolean;
  saveStateChange: 'idle' | 'saving' | 'saved' | 'error';
  capabilityDenied: { capability: string; reason?: string };
  effectiveState: { mode: string; capabilities: readonly string[] };
  disposed: void;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface MogIframeClientOptions {
  iframe: HTMLIFrameElement;
  targetOrigin: string;
  instanceId: string;
  responseTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Client (untrusted parent side)
// ---------------------------------------------------------------------------

export class MogIframeClient {
  private readonly _iframe: HTMLIFrameElement;
  private readonly _targetOrigin: string;
  private readonly _instanceId: string;
  private readonly _responseTimeoutMs: number;
  private readonly _emitter = new ParentEventEmitterBridge();
  private readonly _pendingResponses = new Map<
    string,
    {
      resolve: (msg: MogEmbedMessage) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private _listener: ((e: MessageEvent) => void) | null = null;
  private _disposed = false;
  private _negotiatedVersion: number | null = null;

  constructor(options: MogIframeClientOptions) {
    if (options.targetOrigin === '*') {
      throw new Error('targetOrigin must be an exact origin, never "*"');
    }
    this._iframe = options.iframe;
    this._targetOrigin = options.targetOrigin;
    this._instanceId = options.instanceId;
    this._responseTimeoutMs = options.responseTimeoutMs ?? 10_000;
  }

  get negotiatedVersion(): number | null {
    return this._negotiatedVersion;
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._disposed) {
        reject(new Error('Client is disposed'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for iframe ready'));
      }, 30_000);

      this._startListening();

      const helloMsg = createMessage('hello', {
        supportedVersions: [...SUPPORTED_VERSIONS],
      });

      const onMessage = (event: MessageEvent) => {
        const validated = validateMessageEvent(
          event,
          [this._targetOrigin],
          this._iframe.contentWindow,
        );
        if (!validated) return;

        if (validated.type === 'helloAck' && validated.correlationId === helloMsg.id) {
          const p = validated.payload as Record<string, unknown> | undefined;
          if (p && typeof p.selectedVersion === 'number') {
            this._negotiatedVersion = p.selectedVersion;
            window.removeEventListener('message', onMessage);
            clearTimeout(timeout);
            resolve();
          }
        } else if (
          validated.type === 'versionMismatch' &&
          validated.correlationId === helloMsg.id
        ) {
          window.removeEventListener('message', onMessage);
          clearTimeout(timeout);
          const p = validated.payload as Record<string, unknown> | undefined;
          const supported = Array.isArray(p?.supportedVersions)
            ? (p!.supportedVersions as number[])
            : [];
          reject(new VersionMismatchError([...SUPPORTED_VERSIONS], supported));
        } else if (validated.type === 'ready' && this._negotiatedVersion !== null) {
          window.removeEventListener('message', onMessage);
          clearTimeout(timeout);
          resolve();
        }
      };

      window.addEventListener('message', onMessage);

      const cw = this._iframe.contentWindow;
      if (cw) {
        cw.postMessage(helloMsg, this._targetOrigin);
      }
    });
  }

  dispose(): void {
    if (this._disposed) return;
    this._send('dispose');
    this._disposed = true;
    this._stopListening();
    for (const [id, pending] of this._pendingResponses) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client disposed'));
    }
    this._pendingResponses.clear();
    this._emitter._emit('disposed', undefined as never);
    this._emitter.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Correlated request/response
  // ---------------------------------------------------------------------------

  sendRequest(
    type: MogEmbedMessageType,
    payload?: unknown,
    timeoutMs?: number,
  ): Promise<MogEmbedMessage> {
    return new Promise((resolve, reject) => {
      if (this._disposed) {
        reject(new Error('Client is disposed'));
        return;
      }
      const msg = createMessage(type, payload);
      const ms = timeoutMs ?? this._responseTimeoutMs;
      const timer = setTimeout(() => {
        this._pendingResponses.delete(msg.id);
        reject(new CorrelationTimeoutError(msg.id, ms));
      }, ms);
      this._pendingResponses.set(msg.id, { resolve, reject, timer });
      const cw = this._iframe.contentWindow;
      if (cw) {
        cw.postMessage(msg, this._targetOrigin);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation requests
  // ---------------------------------------------------------------------------

  requestSheetChange(indexOrName: number | string): void {
    this._send('sheetSelect', { target: indexOrName });
  }

  requestRangeSelect(range: string): void {
    this._send('rangeSelect', { range });
  }

  requestScrollTo(row: number, col: number): void {
    this._send('scrollTo', { row, col });
  }

  // ---------------------------------------------------------------------------
  // Save / export requests
  // ---------------------------------------------------------------------------

  requestSave(): void {
    this._send('saveRequested');
  }

  requestExport(format: string): void {
    this._send('exportRequested', { format });
  }

  // ---------------------------------------------------------------------------
  // Event subscription
  // ---------------------------------------------------------------------------

  on<K extends keyof ParentEventMap>(
    event: K,
    handler: (data: ParentEventMap[K]) => void,
  ): () => void {
    return this._emitter.on(event, handler);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _send(type: MogEmbedMessageType, payload?: unknown): void {
    if (this._disposed) return;
    const cw = this._iframe.contentWindow;
    if (!cw) return;
    const msg = createMessage(type, payload);
    cw.postMessage(msg, this._targetOrigin);
  }

  private _startListening(): void {
    if (this._listener) return;
    this._listener = (event: MessageEvent) => {
      const validated = validateMessageEvent(
        event,
        [this._targetOrigin],
        this._iframe.contentWindow,
      );
      if (!validated) return;
      if (validated.correlationId && this._pendingResponses.has(validated.correlationId)) {
        const pending = this._pendingResponses.get(validated.correlationId)!;
        this._pendingResponses.delete(validated.correlationId);
        clearTimeout(pending.timer);
        pending.resolve(validated);
        return;
      }
      this._dispatch(validated);
    };
    window.addEventListener('message', this._listener);
  }

  private _stopListening(): void {
    if (this._listener) {
      window.removeEventListener('message', this._listener);
      this._listener = null;
    }
  }

  private _dispatch(msg: MogEmbedMessage): void {
    const p = msg.payload as Record<string, unknown> | undefined;
    switch (msg.type) {
      case 'ready':
        this._emitter._emit('ready', undefined as never);
        break;
      case 'error':
        this._emitter._emit(
          'error',
          new Error(typeof p?.message === 'string' ? p.message : 'Unknown embed error'),
        );
        break;
      case 'sheetChange':
        if (p && typeof p.index === 'number' && typeof p.name === 'string') {
          this._emitter._emit('sheetChange', { index: p.index, name: p.name });
        }
        break;
      case 'selectionChange':
        if (p && typeof p.row === 'number' && typeof p.col === 'number') {
          this._emitter._emit('selectionChange', { row: p.row, col: p.col });
        }
        break;
      case 'dirtyChange':
        if (p && typeof p.dirty === 'boolean') {
          this._emitter._emit('dirtyChange', p.dirty);
        }
        break;
      case 'saveCompleted':
        this._emitter._emit('saveStateChange', 'saved');
        break;
      case 'saveFailed':
        this._emitter._emit('saveStateChange', 'error');
        break;
      case 'capabilityDenied':
        if (p && typeof p.capability === 'string') {
          this._emitter._emit('capabilityDenied', {
            capability: p.capability,
            reason: typeof p.reason === 'string' ? p.reason : undefined,
          });
        }
        break;
      case 'effectiveCapabilities':
        if (p && typeof p.mode === 'string' && Array.isArray(p.capabilities)) {
          this._emitter._emit('effectiveState', {
            mode: p.mode,
            capabilities: p.capabilities as readonly string[],
          });
        }
        break;
    }
  }
}

// Bridge subclass to expose emit publicly within this module.
class ParentEventEmitterBridge extends TypedEventEmitter<ParentEventMap> {
  _emit<K extends keyof ParentEventMap>(event: K, data: ParentEventMap[K]): void {
    this.emit(event, data);
  }
}
