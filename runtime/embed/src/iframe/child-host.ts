import type { MogEmbedConfig, MogEmbedEffectiveState } from '../config';
import { assertValidMogEmbedConfig } from '../config';
import { resolveEffectiveState, type TrustContext } from '../resolution';
import { TypedEventEmitter } from '../shared/event-emitter';
import {
  type MogEmbedMessage,
  type MogEmbedMessageType,
  SUPPORTED_VERSIONS,
  createMessage,
  negotiateVersion,
  validateMessageEvent,
} from './protocol';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface MogIframeHostOptions {
  allowedParentOrigins: readonly string[];
  channelNonce: string;
  trustContext?: TrustContext;
  onSourceRequest?: (ref: string) => Promise<Uint8Array | null>;
  onConfigResolved?: (effective: MogEmbedEffectiveState) => void;
  onSaveRequest?: () => Promise<boolean>;
  onExportRequest?: (format: string) => Promise<Blob | null>;
}

// ---------------------------------------------------------------------------
// Internal event map (for extensibility; not exposed to parent)
// ---------------------------------------------------------------------------

interface HostInternalEventMap extends Record<string, unknown> {
  parentMessage: MogEmbedMessage;
}

// ---------------------------------------------------------------------------
// Host (trusted child side)
// ---------------------------------------------------------------------------

export class MogIframeHost {
  private readonly _options: MogIframeHostOptions;
  private readonly _emitter = new HostEventEmitterBridge();
  private _listener: ((e: MessageEvent) => void) | null = null;
  private _parentOrigin: string | null = null;
  private _disposed = false;
  private _effectiveState: MogEmbedEffectiveState | null = null;
  private _negotiatedVersion: number | null = null;

  get negotiatedVersion(): number | null {
    return this._negotiatedVersion;
  }

  get effectiveState(): MogEmbedEffectiveState | null {
    return this._effectiveState;
  }

  constructor(options: MogIframeHostOptions) {
    if (options.allowedParentOrigins.length === 0) {
      throw new Error('At least one allowed parent origin is required');
    }
    this._options = options;
  }

  start(): void {
    if (this._listener) return;
    this._listener = (event: MessageEvent) => {
      const validated = validateMessageEvent(
        event,
        this._options.allowedParentOrigins,
        window.parent,
      );
      if (!validated) return;

      this._parentOrigin = event.origin;

      if (validated.type === 'hello') {
        this._handleHello(validated);
        return;
      }

      this._dispatch(validated);
    };
    window.addEventListener('message', this._listener);
  }

  // ---------------------------------------------------------------------------
  // Push events to parent
  // ---------------------------------------------------------------------------

  emitReady(): void {
    this._send('ready');
  }

  emitSheetChange(data: { index: number; name: string }): void {
    this._send('sheetChange', data);
  }

  emitSelectionChange(data: { row: number; col: number }): void {
    this._send('selectionChange', data);
  }

  emitDirtyChange(dirty: boolean): void {
    this._send('dirtyChange', { dirty });
  }

  emitSaveState(state: 'idle' | 'saving' | 'saved' | 'error'): void {
    if (state === 'saved') {
      this._send('saveCompleted');
    } else if (state === 'error') {
      this._send('saveFailed');
    }
  }

  emitEffectiveState(state: MogEmbedEffectiveState): void {
    this._send('effectiveCapabilities', {
      mode: state.mode,
      capabilities: state.capabilities,
      deniedCapabilities: state.deniedCapabilities,
      savePolicy: state.savePolicy,
      collaboration: state.collaboration,
    });
  }

  emitCapabilityDenied(capability: string, reason?: string): void {
    this._send('capabilityDenied', { capability, reason });
  }

  emitError(error: Error): void {
    this._send('error', { message: error.message });
  }

  dispose(): void {
    if (this._disposed) return;
    this._send('dispose');
    this._disposed = true;
    if (this._listener) {
      window.removeEventListener('message', this._listener);
      this._listener = null;
    }
    this._emitter.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _handleHello(msg: MogEmbedMessage): void {
    const p = msg.payload as Record<string, unknown> | undefined;
    const offered = Array.isArray(p?.supportedVersions) ? (p!.supportedVersions as number[]) : [];
    const selected = negotiateVersion(offered);
    if (selected === null) {
      const reply = createMessage(
        'versionMismatch',
        {
          supportedVersions: [...SUPPORTED_VERSIONS],
        },
        msg.id,
      );
      window.parent.postMessage(reply, this._parentOrigin!);
      return;
    }
    this._negotiatedVersion = selected;
    const ack = createMessage('helloAck', { selectedVersion: selected }, msg.id);
    window.parent.postMessage(ack, this._parentOrigin!);
  }

  private _send(type: MogEmbedMessageType, payload?: unknown): void {
    if (this._disposed) return;
    if (!this._parentOrigin) return;
    const msg = createMessage(type, payload);
    // SECURITY: always post to validated parent origin, never '*'.
    window.parent.postMessage(msg, this._parentOrigin);
  }

  private _dispatch(msg: MogEmbedMessage): void {
    const p = msg.payload as Record<string, unknown> | undefined;
    switch (msg.type) {
      case 'sheetSelect':
        // Parent requests a sheet change — child decides whether to honor it.
        break;
      case 'rangeSelect':
        break;
      case 'scrollTo':
        break;
      case 'focusRequest':
        break;
      case 'saveRequested':
        this._handleSaveRequest(msg);
        break;
      case 'exportRequested':
        if (p && typeof p.format === 'string') {
          this._handleExportRequest(msg, p.format);
        }
        break;
      case 'sourceRef':
        if (p && typeof p.ref === 'string') {
          this._resolveConfigIfPresent(p);
          this._handleSourceRequest(p.ref);
        }
        break;
      case 'dispose':
        this.dispose();
        break;
    }
  }

  private _resolveConfigIfPresent(p: Record<string, unknown>): void {
    if (!this._options.trustContext) return;
    const config = (p.config ?? {}) as Partial<MogEmbedConfig>;
    // sourceRef always carries at least the ref; build a minimal MogEmbedConfig
    const fullConfig: MogEmbedConfig = {
      source: { kind: 'file', ref: p.ref as string },
      ...config,
    };
    try {
      assertValidMogEmbedConfig(fullConfig);
      const effective = resolveEffectiveState(fullConfig, this._options.trustContext);
      this._effectiveState = effective;
      this.emitEffectiveState(effective);
      this._options.onConfigResolved?.(effective);
    } catch (err) {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async _handleSaveRequest(msg: MogEmbedMessage): Promise<void> {
    if (!this._options.onSaveRequest) {
      this.emitCapabilityDenied('save', 'Save not supported');
      return;
    }
    try {
      const ok = await this._options.onSaveRequest();
      this.emitSaveState(ok ? 'saved' : 'error');
    } catch {
      this.emitSaveState('error');
    }
  }

  private async _handleExportRequest(msg: MogEmbedMessage, format: string): Promise<void> {
    if (!this._options.onExportRequest) {
      this.emitCapabilityDenied('export', 'Export not supported');
      return;
    }
    try {
      const blob = await this._options.onExportRequest(format);
      if (blob) {
        this._send('exportCompleted', { format });
      } else {
        this.emitCapabilityDenied('export', 'Export failed');
      }
    } catch {
      this.emitError(new Error('Export failed'));
    }
  }

  private async _handleSourceRequest(ref: string): Promise<void> {
    if (!this._options.onSourceRequest) return;
    await this._options.onSourceRequest(ref);
  }
}

class HostEventEmitterBridge extends TypedEventEmitter<HostInternalEventMap> {
  _emit<K extends keyof HostInternalEventMap>(event: K, data: HostInternalEventMap[K]): void {
    this.emit(event, data);
  }
}
