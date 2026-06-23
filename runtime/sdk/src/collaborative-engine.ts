/**
 * CollaborativeEngine — Multi-participant sync wrapper for HeadlessEngine.
 *
 * Wraps HeadlessEngine + SyncCoordinator to enable transparent collaboration.
 * Agent code uses the same Workbook/Worksheet API — sync is invisible.
 *
 * Three sync modes:
 * - 'immediate': push after every mutation (highest consistency)
 * - 'batch': push on flush() or after batchSize mutations
 * - 'manual': framework controls sync (for colab-eval test scenarios)
 *
 * @experimental API surface is not yet stable. Depends on internal NAPI
 * coordinator handles and raw Yrs state boot paths. Subject to breaking
 * changes in minor versions.
 */

import {
  createHeadlessEngine,
  _getDocumentSyncPort,
  type DocumentByteSyncPort,
  type NapiAddonModule,
} from './boot';
import type { Workbook, Worksheet } from '@mog-sdk/contracts/api';
import type {
  DocumentByteSyncPortClassifiedRawProvenance,
  DocumentByteSyncPortRawSyncLifecycle,
} from './document-sync-port-types';

// =============================================================================
// Types
// =============================================================================

/** @experimental */
export type SyncMode = 'immediate' | 'batch' | 'manual';

/** @experimental */
export interface LockScope {
  type: 'sheet' | 'workbook' | 'structural';
  sheetId?: string;
}

/** @experimental */
export interface Lock {
  id: string;
  owner: string;
  scope: LockScope;
}

/** @experimental */
export interface CollaborativeEngineOptions {
  /** Pre-loaded napi addon module. */
  computeAddon: NapiAddonModule;

  /** Coordinator handle (from coordinator_create). If not provided, one is created. */
  coordinatorHandle?: number;

  /** How sync is triggered. Default: 'immediate'. */
  syncMode?: SyncMode;

  /** For batch mode: flush after N mutations. Default: 10. */
  batchSize?: number;

  /** XLSX buffer to import on boot. */
  xlsxSource?: Buffer;

  /** Participant ID. Defaults to random UUID. */
  participantId?: string;

  /** Document ID. Defaults to random UUID. */
  docId?: string;

  /**
   * IANA timezone for the session. Forwarded to the underlying headless
   * boot — see `HeadlessOptions.userTimezone`. Defaults to `'UTC'`.
   */
  userTimezone?: string;
}

/** @experimental */
export interface FlushResult {
  serverDiff: number[];
  ok: boolean;
}

/** @experimental */
export interface SyncResult {
  pushed: boolean;
  pulled: boolean;
}

type CoordinatorRawUpdateClassification = 'bootstrap' | 'flush' | 'pull' | 'sync';

type CoordinatorRawUpdateLifecycle =
  | (DocumentByteSyncPortRawSyncLifecycle & {
      readonly source: 'collaborativeEngineBootstrap';
    })
  | (DocumentByteSyncPortRawSyncLifecycle & {
      readonly source:
        | 'collaborativeEngineFlush'
        | 'collaborativeEnginePull'
        | 'collaborativeEngineSync';
    });

const COORDINATOR_RAW_UPDATE_LIFECYCLE_BY_CLASSIFICATION = Object.freeze({
  bootstrap: {
    schemaVersion: 'sdk-raw-sync-lifecycle-v1',
    source: 'collaborativeEngineBootstrap',
    capturePolicy: 'excluded',
  },
  flush: {
    schemaVersion: 'sdk-raw-sync-lifecycle-v1',
    source: 'collaborativeEngineFlush',
    capturePolicy: 'excluded',
  },
  pull: {
    schemaVersion: 'sdk-raw-sync-lifecycle-v1',
    source: 'collaborativeEnginePull',
    capturePolicy: 'excluded',
  },
  sync: {
    schemaVersion: 'sdk-raw-sync-lifecycle-v1',
    source: 'collaborativeEngineSync',
    capturePolicy: 'excluded',
  },
} satisfies Record<CoordinatorRawUpdateClassification, CoordinatorRawUpdateLifecycle>);

const COORDINATOR_RAW_UPDATE_REDACTION_POLICY = Object.freeze({
  schemaVersion: 'provenance-redaction-policy-v1',
  mode: 'diagnostic-only',
  durableAuthorIdentity: 'unknown',
  durableProviderIdentity: 'unknown',
  proofMaterial: 'diagnostics-only',
} satisfies DocumentByteSyncPortClassifiedRawProvenance['redaction']);

/** @internal */
export async function _applyCoordinatorRawUpdate(
  syncPort: DocumentByteSyncPort,
  update: Uint8Array,
  classification: CoordinatorRawUpdateClassification,
): Promise<void> {
  if (typeof syncPort.applyClassifiedRawUpdate !== 'function') {
    throw new Error(
      `CollaborativeEngine coordinator ${classification} update requires DocumentByteSyncPort.applyClassifiedRawUpdate`,
    );
  }

  const payloadHash = await sha256Hex(update);
  const lifecycle = coordinatorLifecycleForClassification(classification);
  await syncPort.applyClassifiedRawUpdate(
    update,
    buildCoordinatorRawUpdateProvenance(classification, lifecycle, payloadHash),
  );
}

function buildCoordinatorRawUpdateProvenance(
  classification: CoordinatorRawUpdateClassification,
  lifecycle: CoordinatorRawUpdateLifecycle,
  payloadHash: string,
): DocumentByteSyncPortClassifiedRawProvenance {
  const updateIdentity = {
    originKind: 'room' as const,
    updateId: `sdk-coordinator-${classification}:${payloadHash}`,
    payloadHash,
  };

  if (lifecycle.source === 'collaborativeEngineBootstrap') {
    return {
      schemaVersion: 'sync-update-provenance-v1',
      sourceKind: 'collaborationHydration',
      sdkLifecycle: lifecycle,
      updateIdentity,
      trust: { status: 'trustedLocalSystem' },
      author: { kind: 'system', systemRef: 'collaboration-hydration' },
      replay: true,
      system: true,
      capturePolicy: 'excluded',
      redaction: COORDINATOR_RAW_UPDATE_REDACTION_POLICY,
      exclusionDiagnostic: {
        reason: 'hydration',
        message:
          'Coordinator bootstrap alignment is classified as collaborativeEngineBootstrap with capturePolicy=excluded.',
      },
    };
  }

  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'collaborationMixedRemote',
    sdkLifecycle: lifecycle,
    updateIdentity,
    trust: { status: 'unverified' },
    author: { kind: 'mixedRemote', reason: 'aggregateWithoutBoundaries' },
    replay: false,
    system: false,
    capturePolicy: 'excluded',
    redaction: COORDINATOR_RAW_UPDATE_REDACTION_POLICY,
    exclusionDiagnostic: {
      reason: 'mixedAuthors',
      message: `Coordinator ${classification} diff is classified as ${lifecycle.source} with capturePolicy=excluded because it lacks per-update provenance boundaries.`,
    },
  };
}

function coordinatorLifecycleForClassification(
  classification: CoordinatorRawUpdateClassification,
): CoordinatorRawUpdateLifecycle {
  const lifecycle =
    COORDINATOR_RAW_UPDATE_LIFECYCLE_BY_CLASSIFICATION[
      classification as CoordinatorRawUpdateClassification
    ];
  if (!lifecycle) {
    throw new Error(
      `Unknown CollaborativeEngine coordinator raw update lifecycle: ${classification}`,
    );
  }
  return lifecycle;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('CollaborativeEngine coordinator sync classification requires SHA-256 digest');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// =============================================================================
// Coordinator N-API wrapper (thin typed interface over addon functions)
// =============================================================================

/**
 * Typed wrapper for coordinator N-API functions.
 * All coordinator_* functions are on the addon object.
 */
class CoordinatorHandle {
  constructor(
    private readonly addon: NapiAddonModule,
    public readonly handle: number,
  ) {}

  join(participantId: string): {
    fullState: number[];
    activeLocks: Lock[];
    participantCount: number;
  } {
    const fn = this.addon['coordinator_join'] as (h: number, p: string) => any;
    const result = fn(this.handle, participantId);
    return typeof result === 'string' ? JSON.parse(result) : result;
  }

  leave(participantId: string): void {
    const fn = this.addon['coordinator_leave'] as (h: number, p: string) => void;
    fn(this.handle, participantId);
  }

  push(
    participantId: string,
    update: Buffer | Uint8Array,
    touchedSheetIds: string[],
    participantSv: Buffer | Uint8Array,
  ): { ok: boolean; serverDiff?: number[]; error?: string; conflictingLocks?: Lock[] } {
    const fn = this.addon['coordinator_push'] as (
      h: number,
      p: string,
      u: Buffer,
      s: string[],
      sv: Buffer,
    ) => any;
    const result = fn(
      this.handle,
      participantId,
      Buffer.from(update),
      touchedSheetIds,
      Buffer.from(participantSv),
    );
    return typeof result === 'string' ? JSON.parse(result) : result;
  }

  pull(participantId: string, participantSv: Buffer | Uint8Array): Buffer {
    const fn = this.addon['coordinator_pull'] as (h: number, p: string, sv: Buffer) => Buffer;
    return fn(this.handle, participantId, Buffer.from(participantSv));
  }

  stateVector(): Buffer {
    const fn = this.addon['coordinator_state_vector'] as (h: number) => Buffer;
    return fn(this.handle);
  }

  fullState(): Buffer {
    const fn = this.addon['coordinator_full_state'] as (h: number) => Buffer;
    return fn(this.handle);
  }

  acquireLock(owner: string, scope: LockScope, ttlMs: number): string {
    const fn = this.addon['coordinator_acquire_lock'] as (
      h: number,
      o: string,
      s: string,
      t: number,
    ) => string;
    return fn(this.handle, owner, JSON.stringify(scope), ttlMs);
  }

  releaseLock(owner: string, lockId: string): void {
    const fn = this.addon['coordinator_release_lock'] as (h: number, o: string, l: string) => void;
    fn(this.handle, owner, lockId);
  }

  acquireStructuralLock(owner: string, sheetId: string, ttlMs: number): string {
    const fn = this.addon['coordinator_acquire_structural_lock'] as (
      h: number,
      o: string,
      s: string,
      t: number,
    ) => string;
    return fn(this.handle, owner, sheetId, ttlMs);
  }

  releaseStructuralLock(owner: string, lockId: string): void {
    const fn = this.addon['coordinator_release_structural_lock'] as (
      h: number,
      o: string,
      l: string,
    ) => void;
    fn(this.handle, owner, lockId);
  }

  expireLocks(): string[] {
    const fn = this.addon['coordinator_expire_locks'] as (h: number) => string[];
    return fn(this.handle);
  }

  activeLocks(): Lock[] {
    const fn = this.addon['coordinator_active_locks'] as (h: number) => any;
    const result = fn(this.handle);
    return typeof result === 'string' ? JSON.parse(result) : result;
  }

  dispose(): void {
    const fn = this.addon['coordinator_dispose'] as (h: number) => void;
    fn(this.handle);
  }

  static create(addon: NapiAddonModule): CoordinatorHandle {
    const fn = addon['coordinator_create'] as () => number;
    const handle = fn();
    return new CoordinatorHandle(addon, handle);
  }

  static createEmpty(addon: NapiAddonModule): CoordinatorHandle {
    const fn = (addon['coordinator_create_empty'] ?? addon['coordinator_create']) as () => number;
    const handle = fn();
    return new CoordinatorHandle(addon, handle);
  }
}

// =============================================================================
// CollaborativeEngine
// =============================================================================

/** @experimental */
export class CollaborativeEngine {
  private readonly _inner: Awaited<ReturnType<typeof createHeadlessEngine>>;
  private readonly _coordinator: CoordinatorHandle;
  private readonly _participantId: string;
  private readonly _syncMode: SyncMode;
  private readonly _batchSize: number;
  private _pendingMutations = 0;
  private _touchedSheets = new Set<string>();
  private _disposed = false;
  private _ownsCoordinator: boolean;

  /** @internal — use CollaborativeEngine.create() */
  private constructor(
    inner: Awaited<ReturnType<typeof createHeadlessEngine>>,
    coordinator: CoordinatorHandle,
    participantId: string,
    syncMode: SyncMode,
    batchSize: number,
    ownsCoordinator: boolean,
  ) {
    this._inner = inner;
    this._coordinator = coordinator;
    this._participantId = participantId;
    this._syncMode = syncMode;
    this._batchSize = batchSize;
    this._ownsCoordinator = ownsCoordinator;
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  static async create(options: CollaborativeEngineOptions): Promise<CollaborativeEngine> {
    const participantId = options.participantId ?? crypto.randomUUID();
    const syncMode = options.syncMode ?? 'manual';
    const batchSize = options.batchSize ?? 10;

    // Create or use existing coordinator
    let coordinator: CoordinatorHandle;
    let ownsCoordinator: boolean;
    if (options.coordinatorHandle !== undefined) {
      coordinator = new CoordinatorHandle(options.computeAddon, options.coordinatorHandle);
      ownsCoordinator = false;
    } else {
      coordinator = CoordinatorHandle.create(options.computeAddon);
      ownsCoordinator = true;
    }

    // Fork engine from the coordinator's Yrs state bytes.
    //
    // The coordinator creates the canonical Yrs schema (including default Sheet1)
    // in init_canonical_schema(). ALL engines — including Engine 0 — must fork
    // from this state so they share the same Yrs document items and SheetIds.
    //
    // We use `yrsState` (raw Yrs bytes) rather than converting to a JSON snapshot
    // because `from_yrs_state` creates the engine's Yrs doc with the SAME Yrs
    // items as the coordinator. Using a JSON snapshot would create a NEW Yrs doc
    // with different Yrs items — even if SheetId UUIDs matched, the CRDT merge
    // would produce duplicate entries because the items have different origins.
    //
    // Exception: when xlsxSource is provided, the XLSX importer creates its own
    // document structure, so we skip the Yrs state fork path.
    let engine: Awaited<ReturnType<typeof createHeadlessEngine>>;
    if (options.xlsxSource) {
      engine = await createHeadlessEngine({
        computeAddon: options.computeAddon,
        docId: options.docId,
        xlsxSource: options.xlsxSource,
        userTimezone: options.userTimezone,
      });
    } else {
      const yrsState = coordinator.fullState();
      engine = await createHeadlessEngine({
        computeAddon: options.computeAddon,
        docId: options.docId,
        yrsState: new Uint8Array(yrsState),
        userTimezone: options.userTimezone,
      });
    }

    // Join the coordinator
    coordinator.join(participantId);

    // Push this engine's initial state to the coordinator so it
    // has the document content (important for the first participant).
    const syncPort = _getDocumentSyncPort(engine);
    const initSv = await syncPort.currentStateVector();
    const coordSv = coordinator.stateVector();
    const initDiff = await syncPort.encodeDiff(coordSv);
    if (initDiff.length > 0) {
      const pushRaw = coordinator.push(
        participantId,
        Buffer.from(initDiff),
        [],
        Buffer.from(initSv),
      );
      // Apply any existing state from the coordinator back to this engine
      if (pushRaw.ok && pushRaw.serverDiff && pushRaw.serverDiff.length > 0) {
        await _applyCoordinatorRawUpdate(syncPort, new Uint8Array(pushRaw.serverDiff), 'bootstrap');
      }
    }

    return new CollaborativeEngine(
      engine,
      coordinator,
      participantId,
      syncMode,
      batchSize,
      ownsCoordinator,
    );
  }

  /**
   * Create a CollaborativeEngine from the coordinator's current Yrs state.
   *
   * Used for the 2nd, 3rd, ... participants. The coordinator already has state
   * pushed by the first participant. This method:
   * 1. Gets the coordinator's raw Yrs state bytes
   * 2. Creates a HeadlessEngine from those bytes via `from_yrs_state` (same Yrs items)
   * 3. Pushes/pulls to align Yrs docs with the coordinator
   */
  static async createFromCoordinator(options: {
    computeAddon: NapiAddonModule;
    coordinatorHandle: number;
    syncMode?: SyncMode;
    participantId?: string;
    userTimezone?: string;
  }): Promise<CollaborativeEngine> {
    const participantId = options.participantId ?? crypto.randomUUID();
    const syncMode = options.syncMode ?? 'manual';
    const coordinator = new CoordinatorHandle(options.computeAddon, options.coordinatorHandle);

    // Create engine from the coordinator's raw Yrs state bytes.
    // Using raw bytes (via `from_yrs_state`) instead of converting to a JSON
    // snapshot ensures the engine's Yrs doc shares the same items as the
    // coordinator's, which is required for CRDT sync to work correctly.
    const yrsState = coordinator.fullState();
    const engine = await createHeadlessEngine({
      computeAddon: options.computeAddon,
      yrsState: new Uint8Array(yrsState),
      userTimezone: options.userTimezone,
    });

    // Join the coordinator
    coordinator.join(participantId);

    // Push initial state to coordinator (aligns Yrs docs)
    const syncPort = _getDocumentSyncPort(engine);
    const initSv = await syncPort.currentStateVector();
    const coordSv = coordinator.stateVector();
    const initDiff = await syncPort.encodeDiff(coordSv);
    if (initDiff.length > 0) {
      const pushRaw = coordinator.push(
        participantId,
        Buffer.from(initDiff),
        [],
        Buffer.from(initSv),
      );
      if (pushRaw.ok && pushRaw.serverDiff && pushRaw.serverDiff.length > 0) {
        await _applyCoordinatorRawUpdate(syncPort, new Uint8Array(pushRaw.serverDiff), 'bootstrap');
      }
    }

    return new CollaborativeEngine(engine, coordinator, participantId, syncMode, 10, false);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** The standard Workbook API. Agents use this. */
  get workbook(): Workbook {
    return this._inner.workbook;
  }

  /** Convenience: active worksheet. */
  get ws(): Worksheet {
    return this._inner.workbook.activeSheet;
  }

  /** This engine's participant ID. */
  get participantId(): string {
    return this._participantId;
  }

  /** The coordinator handle (for sharing between engines). */
  get coordinatorHandle(): number {
    return this._coordinator.handle;
  }

  /** Current sync mode. */
  get syncMode(): SyncMode {
    return this._syncMode;
  }

  /** Track that a sheet was touched (for lock validation). */
  trackSheetTouch(sheetId: string): void {
    this._touchedSheets.add(sheetId);
    this._pendingMutations++;
  }

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  /**
   * Push local changes to the coordinator.
   * In manual mode, call this explicitly. In immediate mode, auto-called.
   */
  async flush(): Promise<FlushResult> {
    return this.flushClassifiedRawUpdate('flush');
  }

  private async flushClassifiedRawUpdate(
    classification: Extract<CoordinatorRawUpdateClassification, 'flush' | 'sync'>,
  ): Promise<FlushResult> {
    if (this._disposed) throw new Error('Engine is disposed');

    // Get local state vector and diff
    const syncPort = _getDocumentSyncPort(this._inner);
    const localSv = await syncPort.currentStateVector();
    const serverSv = this._coordinator.stateVector();
    const localDiff = await syncPort.encodeDiff(serverSv);

    // Push to coordinator
    const touchedSheets = Array.from(this._touchedSheets);
    const result = this._coordinator.push(
      this._participantId,
      Buffer.from(localDiff),
      touchedSheets,
      Buffer.from(localSv),
    );

    if (!result.ok) {
      this._touchedSheets.clear();
      this._pendingMutations = 0;
      return { serverDiff: [], ok: false };
    }

    // Apply server diff (changes from other participants)
    if (result.serverDiff && result.serverDiff.length > 0) {
      await _applyCoordinatorRawUpdate(syncPort, new Uint8Array(result.serverDiff), classification);
    }

    this._touchedSheets.clear();
    this._pendingMutations = 0;

    return { serverDiff: result.serverDiff ?? [], ok: true };
  }

  /**
   * Pull remote changes from the coordinator.
   */
  async pull(): Promise<void> {
    return this.pullClassifiedRawUpdate('pull');
  }

  private async pullClassifiedRawUpdate(
    classification: Extract<CoordinatorRawUpdateClassification, 'pull' | 'sync'>,
  ): Promise<void> {
    if (this._disposed) throw new Error('Engine is disposed');

    const syncPort = _getDocumentSyncPort(this._inner);
    const localSv = await syncPort.currentStateVector();
    const diff = this._coordinator.pull(this._participantId, Buffer.from(localSv));

    if (diff.length > 0) {
      await _applyCoordinatorRawUpdate(syncPort, diff, classification);
    }
  }

  /**
   * Full sync cycle: push local changes, then pull remote changes.
   */
  async sync(): Promise<SyncResult> {
    const flushResult = await this.flushClassifiedRawUpdate('sync');
    await this.pullClassifiedRawUpdate('sync');
    return { pushed: flushResult.ok, pulled: true };
  }

  // ---------------------------------------------------------------------------
  // Locks
  // ---------------------------------------------------------------------------

  /** Acquire a lock. Returns lock ID. */
  async lock(scope: LockScope, ttlSeconds = 60): Promise<string> {
    return this._coordinator.acquireLock(this._participantId, scope, ttlSeconds * 1000);
  }

  /** Release a lock. */
  async unlock(lockId: string): Promise<void> {
    this._coordinator.releaseLock(this._participantId, lockId);
  }

  /** List all active locks. */
  async locks(): Promise<Lock[]> {
    return this._coordinator.activeLocks();
  }

  // ---------------------------------------------------------------------------
  // Structural locks (serialize insert/delete row/col operations)
  // ---------------------------------------------------------------------------

  /**
   * Acquire a structural lock on a sheet. Only one participant can hold a
   * structural lock per sheet. This serializes insert/delete row/col operations
   * to prevent divergent posToId/idToPos maps under concurrent structural edits.
   *
   * Unlike sheet locks, structural locks do NOT block normal cell edits.
   *
   * @param sheetId UUID string of the sheet to lock
   * @param ttlSeconds Lock TTL in seconds (default 30s — structural ops should be fast)
   * @returns Lock ID string for releasing
   * @throws If another participant holds the structural lock on this sheet
   */
  async acquireStructuralLock(sheetId: string, ttlSeconds = 30): Promise<string> {
    return this._coordinator.acquireStructuralLock(this._participantId, sheetId, ttlSeconds * 1000);
  }

  /**
   * Release a structural lock.
   * @param lockId The lock ID returned by acquireStructuralLock
   */
  async releaseStructuralLock(lockId: string): Promise<void> {
    this._coordinator.releaseStructuralLock(this._participantId, lockId);
  }

  /**
   * Execute a structural operation (insert/delete rows/cols) under a structural
   * lock. Acquires the lock, runs the operation, syncs, then releases the lock.
   * If the lock cannot be acquired (held by another participant), retries up to
   * `maxRetries` times with a short delay.
   *
   * @param sheetId UUID string of the sheet
   * @param operation The structural mutation to perform
   * @param maxRetries Max lock acquisition retries (default 5)
   * @param retryDelayMs Delay between retries in ms (default 50)
   */
  async withStructuralLock<T>(
    sheetId: string,
    operation: () => Promise<T>,
    maxRetries = 5,
    retryDelayMs = 50,
  ): Promise<T> {
    // Try to acquire the structural lock with retries
    let lockId: string | undefined;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        lockId = await this.acquireStructuralLock(sheetId);
        break;
      } catch (e: any) {
        lastError = e;
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    if (!lockId) {
      throw new Error(
        `Failed to acquire structural lock on sheet ${sheetId} after ${maxRetries + 1} attempts: ${lastError?.message}`,
      );
    }

    try {
      // Execute the structural operation
      const result = await operation();
      // Sync after the structural operation so all participants see the change
      await this.flush();
      return result;
    } finally {
      // Always release the lock
      try {
        await this.releaseStructuralLock(lockId);
      } catch {
        // Best-effort release — lock will expire via TTL if this fails
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Dispose the engine — leave coordinator, release locks, dispose engine. */
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;

    try {
      this._coordinator.leave(this._participantId);
    } catch {
      // Ignore coordinator errors during disposal
    }

    if (this._ownsCoordinator) {
      try {
        this._coordinator.dispose();
      } catch {
        // Ignore
      }
    }

    await this._inner.dispose();
  }
}

// =============================================================================
// Helper: Create a shared coordinator + multiple engines
// =============================================================================

/**
 * Create a coordinator and N collaborative engines sharing it.
 * All engines use manual sync mode (for test scenarios).
 *
 * @experimental
 */
export async function createCollaborativeGroup(
  addon: NapiAddonModule,
  count: number,
  options?: {
    syncMode?: SyncMode;
    xlsxSource?: Buffer;
    userTimezone?: string;
  },
): Promise<{
  engines: CollaborativeEngine[];
  coordinatorHandle: number;
  /** Sync all engines: each flushes then pulls. */
  sync: () => Promise<void>;
  /** Dispose all engines and the coordinator. */
  dispose: () => Promise<void>;
}> {
  // Create a shared coordinator
  const coordHandle = options?.xlsxSource
    ? CoordinatorHandle.createEmpty(addon)
    : CoordinatorHandle.create(addon);

  const engines: CollaborativeEngine[] = [];

  // Create the first engine (the "origin" engine)
  const first = await CollaborativeEngine.create({
    computeAddon: addon,
    coordinatorHandle: coordHandle.handle,
    syncMode: options?.syncMode ?? 'manual',
    participantId: `participant-0`,
    xlsxSource: options?.xlsxSource,
    userTimezone: options?.userTimezone,
  });
  engines.push(first);

  // For subsequent engines: create from the coordinator's Yrs state.
  // This ensures all engines share the same CellIds and Yrs document history,
  // which is required for CRDT sync to work. We use yrs_state_to_snapshot_json
  // to convert the Yrs state into a WorkbookSnapshot, then create the engine
  // from that snapshot and apply the Yrs state to align the Yrs doc.
  for (let i = 1; i < count; i++) {
    const engine = await CollaborativeEngine.createFromCoordinator({
      computeAddon: addon,
      coordinatorHandle: coordHandle.handle,
      syncMode: options?.syncMode ?? 'manual',
      participantId: `participant-${i}`,
      userTimezone: options?.userTimezone,
    });
    engines.push(engine);
  }

  return {
    engines,
    coordinatorHandle: coordHandle.handle,
    sync: async () => {
      // Each engine pushes, then all pull
      for (const engine of engines) {
        await engine.flush();
      }
      for (const engine of engines) {
        await engine.pull();
      }
    },
    dispose: async () => {
      for (const engine of engines) {
        await engine.dispose();
      }
      coordHandle.dispose();
    },
  };
}
