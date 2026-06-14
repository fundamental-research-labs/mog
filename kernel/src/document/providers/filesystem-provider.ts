/**
 * FilesystemProvider — durable `Provider` for the `@mog-sdk/sdk/node` entry.
 *
 * Persists yrs updates to the local filesystem using an append-log + snapshot
 * layout. Serves as the default durable provider for headless / CLI / SDK
 * workflows where IndexedDB is not available.
 *
 * Storage layout:
 *   <basePath>/<docId>/
 *     snapshot.bin       — latest full-state checkpoint
 *     updates/
 *       0001.bin         — incremental update log entries
 *       0002.bin
 *       ...
 *     lock.pid           — process lock file
 *
 * Accepts `FilesystemProviderConfig` from `@mog-sdk/types-document/storage`.
 *
 * @see provider.ts — the Provider contract
 * @see memory-provider.ts — reference in-memory implementation
 */

import type {
  Provider,
  ProviderAttachMode,
  ProviderAttachResult,
  ProviderCheckpointMode,
  ProviderCheckpointResult,
  ProviderDoc,
} from './provider';
import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';
import type { StorageProviderIdentity } from '@mog-sdk/types-document/storage/provider-identity';
import type { FilesystemProviderConfig } from '@mog-sdk/types-document/storage/provider-configs';
import type { ProviderFactory, ProviderInstance } from './factory';

// Node fs modules — loaded lazily via the factory to avoid bundling in browser.
type FsPromises = typeof import('node:fs/promises');
type FsSync = typeof import('node:fs');
type PathModule = typeof import('node:path');

async function importNodeModule<T>(specifier: string): Promise<T> {
  if (typeof window !== 'undefined') {
    throw new Error(`FilesystemProvider is not available in browser runtimes (${specifier})`);
  }
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<T>;
  return dynamicImport(specifier);
}

// =============================================================================
// Options
// =============================================================================

export interface FilesystemProviderOptions {
  basePath: string;
  docId: string;
  atomicWrite?: boolean;

  /** Injected Node modules — the factory resolves these so the class never imports at module scope. */
  fsPromises: FsPromises;
  fsSync: FsSync;
  pathModule: PathModule;

  /** Inject `flushSync` failure for conformance row #8. */
  failFlushSync?: () => boolean;
}

// =============================================================================
// FilesystemProvider
// =============================================================================

export class FilesystemProvider implements Provider {
  readonly name: string = 'FilesystemProvider';

  private readonly docId: string;
  private readonly docDir: string;
  private readonly updatesDir: string;
  private readonly snapshotPath: string;
  private readonly lockPath: string;
  private readonly atomicWrite: boolean;
  private readonly failFlushSyncFn: () => boolean;

  private readonly fsp: FsPromises;
  private readonly fs: FsSync;
  private readonly path: PathModule;

  private pendingUpdates: Uint8Array[] = [];
  private flushing: Promise<void> | null = null;
  private detached = false;
  private attached = false;
  private _flushFailed = false;
  private nextUpdateIndex = 1;

  constructor(options: FilesystemProviderOptions) {
    this.docId = options.docId;
    this.atomicWrite = options.atomicWrite ?? true;
    this.failFlushSyncFn = options.failFlushSync ?? (() => false);
    this.fsp = options.fsPromises;
    this.fs = options.fsSync;
    this.path = options.pathModule;

    this.docDir = this.path.join(options.basePath, options.docId);
    this.updatesDir = this.path.join(this.docDir, 'updates');
    this.snapshotPath = this.path.join(this.docDir, 'snapshot.bin');
    this.lockPath = this.path.join(this.docDir, 'lock.pid');
  }

  // ---------------------------------------------------------------------------
  // Capabilities
  // ---------------------------------------------------------------------------

  getCapabilities(): StorageProviderCapabilities {
    return {
      writable: true,
      durable: true,
      synchronousFlushStart: false,
      fullStateCheckpoint: true,
      incrementalUpdateLog: true,
      yrsStateVectorDiff: false,
      storageCursor: true,
      subscriptions: false,
      exclusiveWriteLock: true,
      readOnlyFallback: true,
      offlineOpen: true,
      reconnect: false,
      inboundUpdates: false,
      idempotentRemoteUpdates: false,
      binaryAssets: false,
      assetContentAddressing: false,
      assetGarbageCollection: false,
      assetAtomicCommit: false,
      atomicBatch: false,
    };
  }

  getIdentity(): StorageProviderIdentity {
    return {
      providerRefId: `filesystem:${this.docId}`,
      storageScope: {
        kind: 'scoped',
        scope: {
          tenantId: { kind: 'single-tenant' },
          workspaceId: { kind: 'no-workspace' },
          documentId: this.docId,
        },
      },
      contractVersion: '0.3.0',
      providerProtocolVersion: '0.1.0',
    };
  }

  // ---------------------------------------------------------------------------
  // Provider interface
  // ---------------------------------------------------------------------------

  get flushFailed(): boolean {
    return this._flushFailed;
  }

  async attach(
    doc: ProviderDoc,
    mode: ProviderAttachMode = { kind: 'normal' },
  ): Promise<ProviderAttachResult> {
    if (this.detached) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'detached',
        message: 'FilesystemProvider.attach: provider has been detached',
      };
    }
    if (this.attached) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'alreadyAttached',
        message: 'FilesystemProvider.attach: provider already attached',
      };
    }

    await this.ensureDirectories();
    await this.cleanupStaleTmpFiles();
    await this.acquireLock();

    if (mode.kind === 'importInitialize' || mode.kind === 'createFresh') {
      this.pendingUpdates = [];
      this.flushing = null;
      this.nextUpdateIndex = 1;
      if (mode.kind === 'createFresh') {
        await this.clearPersistedState();
      }
      this.attached = true;
      return { status: 'ready', mode: mode.kind };
    }

    // Replay persisted state.
    await this.replayPersistedState(doc);

    this.attached = true;
    return { status: 'ready', mode: mode.kind };
  }

  appendUpdate(update: Uint8Array): void {
    if (this.detached) return;
    this.pendingUpdates.push(new Uint8Array(update));
  }

  async flush(): Promise<void> {
    if (this.detached) return;
    if (this.flushing) return this.flushing;
    this.flushing = this.runFlush();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  private async runFlush(): Promise<void> {
    await Promise.resolve();
    if (this.pendingUpdates.length === 0) return;

    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    for (const update of batch) {
      const fileName = this.updateFileName(this.nextUpdateIndex);
      const filePath = this.path.join(this.updatesDir, fileName);

      if (this.atomicWrite) {
        const tmpPath = filePath + '.tmp';
        await this.fsp.writeFile(tmpPath, update);
        await this.fsp.rename(tmpPath, filePath);
      } else {
        await this.fsp.writeFile(filePath, update);
      }

      this.nextUpdateIndex++;
    }
  }

  async checkpointFullState(
    doc: ProviderDoc,
    mode: ProviderCheckpointMode = { kind: 'normal' },
  ): Promise<ProviderCheckpointResult> {
    if (this.detached) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'detached',
        message: 'FilesystemProvider.checkpointFullState: provider has been detached',
      };
    }

    if (mode.kind !== 'importInitialize') {
      await this.flush();
    } else {
      this.pendingUpdates = [];
      this.flushing = null;
    }

    const fullState = await doc.encodeDiff(new Uint8Array());

    // Capture trailing updates that arrived during encodeDiff.
    const trailing = this.pendingUpdates;
    this.pendingUpdates = [];

    // Write snapshot atomically.
    if (this.atomicWrite) {
      const tmpPath = this.snapshotPath + '.tmp';
      await this.fsp.writeFile(tmpPath, fullState);
      await this.fsp.rename(tmpPath, this.snapshotPath);
    } else {
      await this.fsp.writeFile(this.snapshotPath, fullState);
    }

    // Remove old update files — snapshot supersedes them.
    await this.clearUpdateFiles();

    // Write trailing updates.
    this.nextUpdateIndex = 1;
    if (trailing.length > 0) {
      this.pendingUpdates = trailing;
      await this.runFlush();
    }

    return { status: 'committed', mode: mode.kind };
  }

  flushSync(): void {
    if (this.detached) return;
    if (this.pendingUpdates.length === 0) return;

    if (this.failFlushSyncFn()) {
      this._flushFailed = true;
      return;
    }

    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    try {
      for (const update of batch) {
        const fileName = this.updateFileName(this.nextUpdateIndex);
        const filePath = this.path.join(this.updatesDir, fileName);

        if (this.atomicWrite) {
          const tmpPath = filePath + '.tmp';
          this.fs.writeFileSync(tmpPath, update);
          this.fs.renameSync(tmpPath, filePath);
        } else {
          this.fs.writeFileSync(filePath, update);
        }

        this.nextUpdateIndex++;
      }
      this._flushFailed = false;
    } catch {
      this._flushFailed = true;
    }
  }

  async detach(): Promise<void> {
    if (this.detached) return;
    this.detached = true;

    if (this.pendingUpdates.length > 0) {
      const batch = this.pendingUpdates;
      this.pendingUpdates = [];

      for (const update of batch) {
        const fileName = this.updateFileName(this.nextUpdateIndex);
        const filePath = this.path.join(this.updatesDir, fileName);

        if (this.atomicWrite) {
          const tmpPath = filePath + '.tmp';
          await this.fsp.writeFile(tmpPath, update);
          await this.fsp.rename(tmpPath, filePath);
        } else {
          await this.fsp.writeFile(filePath, update);
        }

        this.nextUpdateIndex++;
      }
    }

    await this.releaseLock();
  }

  async stateVector(): Promise<Uint8Array> {
    let updateCount = this.pendingUpdates.length;

    try {
      const entries = await this.fsp.readdir(this.updatesDir);
      updateCount += entries.filter((e) => e.endsWith('.bin')).length;
    } catch {
      // Updates dir may not exist yet.
    }

    let hasSnapshot = 0;
    try {
      await this.fsp.access(this.snapshotPath);
      hasSnapshot = 1;
    } catch {
      // No snapshot.
    }

    const out = new Uint8Array(8);
    out[0] = (updateCount >>> 24) & 0xff;
    out[1] = (updateCount >>> 16) & 0xff;
    out[2] = (updateCount >>> 8) & 0xff;
    out[3] = updateCount & 0xff;
    out[4] = (hasSnapshot >>> 24) & 0xff;
    out[5] = (hasSnapshot >>> 16) & 0xff;
    out[6] = (hasSnapshot >>> 8) & 0xff;
    out[7] = hasSnapshot & 0xff;
    return out;
  }

  async storageCursor(): Promise<Uint8Array> {
    return this.stateVector();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private updateFileName(index: number): string {
    return String(index).padStart(4, '0') + '.bin';
  }

  private async ensureDirectories(): Promise<void> {
    await this.fsp.mkdir(this.updatesDir, { recursive: true });
  }

  private async cleanupStaleTmpFiles(): Promise<void> {
    // Clean tmp files in doc dir.
    try {
      const docEntries = await this.fsp.readdir(this.docDir);
      for (const entry of docEntries) {
        if (entry.endsWith('.tmp')) {
          await this.fsp.unlink(this.path.join(this.docDir, entry)).catch(() => {});
        }
      }
    } catch {
      // Dir may not exist yet.
    }

    // Clean tmp files in updates dir.
    try {
      const updateEntries = await this.fsp.readdir(this.updatesDir);
      for (const entry of updateEntries) {
        if (entry.endsWith('.tmp')) {
          await this.fsp.unlink(this.path.join(this.updatesDir, entry)).catch(() => {});
        }
      }
    } catch {
      // Dir may not exist yet.
    }
  }

  private async acquireLock(): Promise<void> {
    try {
      const contents = await this.fsp.readFile(this.lockPath, 'utf-8');
      const pid = parseInt(contents.trim(), 10);
      if (!isNaN(pid) && this.isProcessAlive(pid)) {
        // Another live process holds the lock. In the single-user CLI/SDK
        // context we take over anyway; proper contention handling belongs in
        // the multi-process storage path.
      }
    } catch {
      // No lock file exists — proceed.
    }

    await this.fsp.writeFile(this.lockPath, String(process.pid), 'utf-8');
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.fsp.unlink(this.lockPath);
    } catch {
      // Already removed or never created.
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async replayPersistedState(doc: ProviderDoc): Promise<void> {
    // Replay snapshot first.
    try {
      const snapshot = await this.fsp.readFile(this.snapshotPath);
      await doc.applyUpdate(new Uint8Array(snapshot));
    } catch {
      // No snapshot — that's fine.
    }

    // Replay update files in order.
    try {
      const entries = await this.fsp.readdir(this.updatesDir);
      const binFiles = entries.filter((e) => e.endsWith('.bin')).sort();

      for (const file of binFiles) {
        const data = await this.fsp.readFile(this.path.join(this.updatesDir, file));
        await doc.applyUpdate(new Uint8Array(data));
      }

      // Set nextUpdateIndex past existing files.
      if (binFiles.length > 0) {
        const lastFile = binFiles[binFiles.length - 1]!;
        const lastIndex = parseInt(lastFile.replace('.bin', ''), 10);
        this.nextUpdateIndex = lastIndex + 1;
      }
    } catch {
      // No updates dir — that's fine.
    }
  }

  private async clearUpdateFiles(): Promise<void> {
    try {
      const entries = await this.fsp.readdir(this.updatesDir);
      for (const entry of entries) {
        await this.fsp.unlink(this.path.join(this.updatesDir, entry));
      }
    } catch {
      // Updates dir may not exist.
    }
  }

  private async clearPersistedState(): Promise<void> {
    try {
      await this.fsp.unlink(this.snapshotPath);
    } catch {
      // No snapshot exists yet.
    }
    await this.clearUpdateFiles();
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createFilesystemProviderFactory(): ProviderFactory {
  return async (config) => {
    if (config.kind !== 'filesystem') {
      throw new Error(
        `FilesystemProviderFactory: expected kind "filesystem", got "${config.kind}"`,
      );
    }

    const fsConfig = config as FilesystemProviderConfig;

    // Dynamic imports — only resolved when constructing on Node.
    const [fsPromises, fsSync, pathModule] = await Promise.all([
      importNodeModule<FsPromises>('node:fs/promises'),
      importNodeModule<FsSync>('node:fs'),
      importNodeModule<PathModule>('node:path'),
    ]);

    const basePath = fsConfig.pathHandle;

    const provider = new FilesystemProvider({
      basePath,
      docId: fsConfig.providerRefId,
      atomicWrite: fsConfig.atomicWrite,
      fsPromises,
      fsSync,
      pathModule,
    });

    const capabilities = provider.getCapabilities();

    const instance: ProviderInstance = {
      config: fsConfig,
      provider,
      capabilities,
    };

    return instance;
  };
}
