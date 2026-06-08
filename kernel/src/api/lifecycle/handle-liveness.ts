import { KernelError } from '../../errors';
import type { KernelErrorCode } from '../../errors';

export type HandleLivenessState = 'live' | 'disposed';

export interface HandleLivenessMetadata {
  readonly label?: string;
  readonly documentId?: string;
  readonly workbookId?: string;
  readonly sessionId?: string;
  readonly [key: string]: unknown;
}

export interface HandleLivenessInvalidateReason {
  readonly operation?: string;
  readonly message?: string;
  readonly code?: Extract<KernelErrorCode, 'BRIDGE_DISPOSED' | 'DOC_DISPOSED'>;
  readonly metadata?: HandleLivenessMetadata;
}

export interface HandleLivenessOptions {
  readonly label: string;
  readonly code?: Extract<KernelErrorCode, 'BRIDGE_DISPOSED' | 'DOC_DISPOSED'>;
  readonly metadata?: HandleLivenessMetadata;
}

export type HandleInvalidationListener = (reason: HandleLivenessInvalidateReason) => void;

/**
 * Shared synchronous liveness token for public API facades that wrap one
 * document/workbook session. It flips before async teardown starts so stale
 * handles fail before touching the bridge.
 */
export class HandleLiveness {
  private readonly listeners = new Set<HandleInvalidationListener>();
  private _state: HandleLivenessState = 'live';
  private _reason: HandleLivenessInvalidateReason | null = null;

  constructor(private readonly options: HandleLivenessOptions) {}

  get state(): HandleLivenessState {
    return this._state;
  }

  get isDisposed(): boolean {
    return this._state === 'disposed';
  }

  invalidate(reason: HandleLivenessInvalidateReason = {}): void {
    if (this._state === 'disposed') return;
    this._state = 'disposed';
    this._reason = {
      operation: reason.operation,
      message: reason.message,
      code: reason.code ?? this.options.code ?? 'BRIDGE_DISPOSED',
      metadata: { ...this.options.metadata, ...reason.metadata },
    };

    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) {
      listener(this._reason);
    }
  }

  onInvalidate(listener: HandleInvalidationListener): () => void {
    if (this._reason) {
      listener(this._reason);
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  assertLive(operation: string): void {
    if (!this._reason) return;
    throw this.error(operation);
  }

  error(operation: string): KernelError {
    const reason = this._reason;
    const metadata = { ...this.options.metadata, ...reason?.metadata };
    const label = metadata.label ?? this.options.label;
    const reasonOperation = reason?.operation;
    const message =
      reason?.message ?? `${label}.${operation}: handle is disposed, closed, or invalidated`;
    return new KernelError(reason?.code ?? this.options.code ?? 'BRIDGE_DISPOSED', message, {
      context: {
        operation,
        ...(reasonOperation ? { invalidatedBy: reasonOperation } : {}),
        ...metadata,
      },
    });
  }
}

export function createHandleLiveness(options: HandleLivenessOptions): HandleLiveness {
  return new HandleLiveness(options);
}
