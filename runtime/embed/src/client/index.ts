/**
 * MogClient — production-stack client for @mog-sdk/embed.
 *
 * @stability public-experimental
 * @remarks
 * This is the `@mog-sdk/embed/client` entrypoint. The client is a public
 * Current transport primitive, but its workbook and worksheet accessors expose
 * only narrow public handles. Kernel/workbook implementation types stay
 * internal to the bundled artifact.
 *
 * Uses createWorkbook() from @mog-sdk/kernel/api to bootstrap a full
 * Workbook instance from host-authorized XLSX bytes. Public embed components
 * must resolve opaque source refs through a host policy before constructing
 * this bundled client.
 *
 * - FSM status management (loading -> ready -> error -> disposed)
 * - TypedEventEmitter (no manual listener map management)
 * - Exposes Workbook/Worksheet API for production-quality cell access
 */

import { createWorkbook } from '@mog-sdk/kernel';
import { TypedEventEmitter } from '../shared/event-emitter';
import type { EmbedStatus, EmbedEventMap } from '../types';
export type { EmbedStatus, EmbedEventMap } from '../types';

interface InternalWorkbook {
  readonly activeSheet: InternalWorksheet;
  readonly viewport?: {
    createRegion(sheetId: string, bounds: unknown): unknown;
  };
  readonly isDirty: boolean;
  getSheetNames(): Promise<string[]>;
  dispose(): void;
  markClean(): void;
  sheets: {
    setActive(indexOrName: number | string): Promise<void>;
  };
}

interface InternalWorksheet {
  getIndex(): number;
  getSheetId(): string;
  getCell(row: number, col: number): Promise<MogClientCell | null> | MogClientCell | null;
}

/** @stability public-experimental */
export interface MogClientCell {
  readonly formula?: string | null;
  readonly value?: unknown;
}

/** @stability public-experimental */
export interface MogClientWorksheet {
  getIndex(): number;
  getSheetId(): string;
  getCell(row: number, col: number): Promise<MogClientCell | null> | MogClientCell | null;
}

/** @stability public-experimental */
export interface MogClientWorkbookHandle {
  readonly isDirty: boolean;
  markClean(): void;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export interface MogClientOptions {
  /** Host-authorized XLSX bytes. */
  sourceBytes: ArrayBuffer | Uint8Array;
  /** Initial sheet (index or name) */
  sheet?: number | string;
}

// ---------------------------------------------------------------------------
// MogClient
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export class MogClient {
  /** Resolves when the client reaches 'ready' status. Rejects on error. */
  readonly ready: Promise<void>;

  private _status: EmbedStatus = 'loading';
  private _workbook: InternalWorkbook | null = null;
  private readonly _emitter = new ClientEventEmitterBridge();

  constructor(options: MogClientOptions) {
    this.ready = this._boot(options);
  }

  // ---------------------------------------------------------------------------
  // Public getters
  // ---------------------------------------------------------------------------

  get status(): EmbedStatus {
    return this._status;
  }

  /** The underlying production Workbook instance (null until ready). */
  get workbook(): MogClientWorkbookHandle | null {
    return this._workbook;
  }

  // ---------------------------------------------------------------------------
  // Public API — Sheet access
  // ---------------------------------------------------------------------------

  /** Get the currently active Worksheet. Throws if not ready. */
  getActiveSheet(): MogClientWorksheet {
    this._assertReady();
    return this._workbook!.activeSheet;
  }

  /** Get the names of all sheets in order. */
  async getSheets(): Promise<string[]> {
    this._assertReady();
    return this._workbook!.getSheetNames();
  }

  /** Switch to a different sheet by index or name. */
  async setActiveSheet(indexOrName: number | string): Promise<MogClientWorksheet> {
    this._assertReady();
    const wb = this._workbook!;
    await wb.sheets.setActive(indexOrName);
    return wb.activeSheet;
  }

  // ---------------------------------------------------------------------------
  // Public API — Viewport
  // ---------------------------------------------------------------------------

  /** Access the viewport sub-API on the workbook (for creating regions, etc.). */
  get viewport(): unknown | null {
    return this._workbook?.viewport ?? null;
  }

  /**
   * Create a viewport region for the given sheet and bounds.
   * Returns a disposable ViewportRegion handle.
   */
  createViewportRegion(sheetId: string, bounds: unknown): unknown | null {
    const vp = this._workbook?.viewport;
    if (!vp) return null;
    return vp.createRegion(sheetId, bounds);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Tear down the client, workbook, and all listeners. */
  dispose(): void {
    if (this._status === 'disposed') return;
    this._workbook?.dispose();
    this._workbook = null;
    this._setStatus('disposed');
    this._emitter.removeAllListeners();
  }

  on<K extends keyof EmbedEventMap>(
    event: K,
    handler: (data: EmbedEventMap[K]) => void,
  ): () => void {
    return this._emitter.on(event, handler);
  }

  // ---------------------------------------------------------------------------
  // Status FSM
  // ---------------------------------------------------------------------------

  private _setStatus(status: EmbedStatus): void {
    this._status = status;
    this._emitter._emit('status', status);
  }

  private _assertReady(): void {
    if (this._status !== 'ready') {
      throw new Error(`MogClient is not ready (status: ${this._status})`);
    }
  }

  // ---------------------------------------------------------------------------
  // Boot sequence
  // ---------------------------------------------------------------------------

  private async _boot(options: MogClientOptions): Promise<void> {
    try {
      // 1. Resolve source bytes
      const xlsxBytes = this._normalizeSourceBytes(options.sourceBytes);

      // 2. Create workbook via zero-ceremony path
      this._workbook = (await createWorkbook(xlsxBytes)) as unknown as InternalWorkbook;

      // 3. If a specific sheet was requested, switch to it
      if (options.sheet != null) {
        await this.setActiveSheet(options.sheet);
      }

      // 4. Transition to ready
      this._setStatus('ready');
      this._emitter._emit('ready', undefined);
    } catch (err) {
      this._setStatus('error');
      const error = err instanceof Error ? err : new Error(String(err));
      this._emitter._emit('error', error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Source resolution
  // ---------------------------------------------------------------------------

  private _normalizeSourceBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
    if (source instanceof Uint8Array) return source;
    return new Uint8Array(source);
  }
}

class ClientEventEmitterBridge extends TypedEventEmitter<EmbedEventMap> {
  _emit<K extends keyof EmbedEventMap>(event: K, data: EmbedEventMap[K]): void {
    this.emit(event, data);
  }
}
