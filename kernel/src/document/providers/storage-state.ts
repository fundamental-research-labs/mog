/**
 * Storage State — tracks the current storage subsystem's health and mode.
 *
 * The StorageState is a read-only snapshot of the storage layer's current
 * condition: which phase the lifecycle is in, what durability mode is active,
 * whether the doc is readOnly, which providers are degraded, and any
 * accumulated errors.
 *
 */

/**
 * DurabilityMode — local alias for the storage subsystem's durability level.
 * Maps to DocumentDurabilityMode from the types package.
 */
export type DurabilityMode =
  | 'ephemeral'
  | 'durableLocal'
  | 'localFirst'
  | 'remoteBacked'
  | 'readOnly';

export type StoragePhase = 'idle' | 'attaching' | 'ready' | 'degraded' | 'error' | 'disposed';

export interface StorageStateSnapshot {
  phase: StoragePhase;
  durabilityMode: DurabilityMode;
  readOnly: boolean;
  degradedProviders: string[];
  errors: StorageError[];
}

export interface StorageError {
  provider: string;
  message: string;
  timestamp: number;
}

export class StorageState {
  private _phase: StoragePhase = 'idle';
  private _durabilityMode: DurabilityMode = 'ephemeral';
  private _readOnly = false;
  private _degradedProviders: string[] = [];
  private _errors: StorageError[] = [];

  get phase(): StoragePhase {
    return this._phase;
  }

  get durabilityMode(): DurabilityMode {
    return this._durabilityMode;
  }

  get readOnly(): boolean {
    return this._readOnly;
  }

  get degradedProviders(): readonly string[] {
    return this._degradedProviders;
  }

  get errors(): readonly StorageError[] {
    return this._errors;
  }

  setPhase(phase: StoragePhase): void {
    this._phase = phase;
  }

  setDurabilityMode(mode: DurabilityMode): void {
    this._durabilityMode = mode;
  }

  setReadOnly(readOnly: boolean): void {
    this._readOnly = readOnly;
  }

  addDegradedProvider(provider: string): void {
    if (!this._degradedProviders.includes(provider)) {
      this._degradedProviders.push(provider);
    }
    if (this._phase === 'ready') {
      this._phase = 'degraded';
    }
  }

  addError(error: StorageError): void {
    this._errors.push(error);
  }

  snapshot(): StorageStateSnapshot {
    return {
      phase: this._phase,
      durabilityMode: this._durabilityMode,
      readOnly: this._readOnly,
      degradedProviders: [...this._degradedProviders],
      errors: [...this._errors],
    };
  }
}
