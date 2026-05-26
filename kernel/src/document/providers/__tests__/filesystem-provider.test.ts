/**
 * FilesystemProvider — conformance + provider-specific tests.
 *
 * Uses a temp directory per test run for isolation. Cleans up after.
 *
 * @see conformance.ts — shared conformance suite
 * @see filesystem-provider.ts — the provider under test
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runProviderConformance } from './conformance';
import { buildMockProviderDoc, makeUpdate } from './mock-provider-doc';
import { FilesystemProvider } from '../filesystem-provider';
import type { FilesystemProviderOptions } from '../filesystem-provider';

// =============================================================================
// Temp directory management
// =============================================================================

let tmpRoot: string;
const DOC_ID = 'fs-provider-conformance';

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mog-fs-provider-'));
  return dir;
}

function makeOptions(overrides?: Partial<FilesystemProviderOptions>): FilesystemProviderOptions {
  return {
    basePath: tmpRoot,
    docId: DOC_ID,
    atomicWrite: true,
    fsPromises: fsp,
    fsSync: fs,
    pathModule: path,
    ...overrides,
  };
}

// =============================================================================
// Conformance suite
// =============================================================================

beforeEach(() => {
  tmpRoot = makeTmpDir();
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

runProviderConformance({
  name: 'FilesystemProvider',
  factory: () => new FilesystemProvider(makeOptions()),
  buildProviderDoc: buildMockProviderDoc,
  resetStorage: async () => {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = makeTmpDir();
  },
  factoryWithFailingFlushSync: () =>
    new FilesystemProvider(makeOptions({ failFlushSync: () => true })),
});

// =============================================================================
// FilesystemProvider-specific tests
// =============================================================================

describe('FilesystemProvider — specific', () => {
  let basePath: string;

  beforeEach(() => {
    basePath = makeTmpDir();
  });

  afterEach(async () => {
    await fsp.rm(basePath, { recursive: true, force: true });
  });

  function opts(overrides?: Partial<FilesystemProviderOptions>): FilesystemProviderOptions {
    return {
      basePath,
      docId: 'specific-test',
      atomicWrite: true,
      fsPromises: fsp,
      fsSync: fs,
      pathModule: path,
      ...overrides,
    };
  }

  it('getCapabilities returns correct flags', () => {
    const provider = new FilesystemProvider(opts());
    const caps = provider.getCapabilities();
    expect(caps.writable).toBe(true);
    expect(caps.durable).toBe(true);
    expect(caps.synchronousFlushStart).toBe(false);
    expect(caps.fullStateCheckpoint).toBe(true);
    expect(caps.incrementalUpdateLog).toBe(true);
    expect(caps.offlineOpen).toBe(true);
    expect(caps.exclusiveWriteLock).toBe(true);
    expect(caps.readOnlyFallback).toBe(true);
    expect(caps.storageCursor).toBe(true);
    expect(caps.yrsStateVectorDiff).toBe(false);
    expect(caps.subscriptions).toBe(false);
    expect(caps.reconnect).toBe(false);
    expect(caps.binaryAssets).toBe(false);
    expect(caps.atomicBatch).toBe(false);
  });

  it('getIdentity returns StorageProviderIdentity with correct fields', () => {
    const provider = new FilesystemProvider(opts());
    const id = provider.getIdentity();
    expect(id.providerRefId).toBe('filesystem:specific-test');
    expect(id.storageScope).toEqual({
      kind: 'scoped',
      scope: {
        tenantId: { kind: 'single-tenant' },
        workspaceId: { kind: 'no-workspace' },
        documentId: 'specific-test',
      },
    });
    expect(id.contractVersion).toBe('0.3.0');
    expect(id.providerProtocolVersion).toBe('0.1.0');
  });

  it('creates directory structure on attach', async () => {
    const provider = new FilesystemProvider(opts());
    const doc = buildMockProviderDoc('specific-test');
    await provider.attach(doc);

    const docDir = path.join(basePath, 'specific-test');
    const updatesDir = path.join(docDir, 'updates');
    expect(fs.existsSync(docDir)).toBe(true);
    expect(fs.existsSync(updatesDir)).toBe(true);

    await provider.detach();
  });

  it('writes lock.pid on attach, removes on detach', async () => {
    const provider = new FilesystemProvider(opts());
    const doc = buildMockProviderDoc('specific-test');
    await provider.attach(doc);

    const lockPath = path.join(basePath, 'specific-test', 'lock.pid');
    expect(fs.existsSync(lockPath)).toBe(true);
    const pid = fs.readFileSync(lockPath, 'utf-8').trim();
    expect(parseInt(pid, 10)).toBe(process.pid);

    await provider.detach();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('writes numbered update files on flush', async () => {
    const provider = new FilesystemProvider(opts());
    const doc = buildMockProviderDoc('specific-test');
    await provider.attach(doc);

    provider.appendUpdate(makeUpdate(1));
    provider.appendUpdate(makeUpdate(2));
    provider.appendUpdate(makeUpdate(3));
    await provider.flush();

    const updatesDir = path.join(basePath, 'specific-test', 'updates');
    const files = fs.readdirSync(updatesDir).sort();
    expect(files).toEqual(['0001.bin', '0002.bin', '0003.bin']);

    await provider.detach();
  });

  it('cleans up stale .tmp files on attach', async () => {
    const docDir = path.join(basePath, 'specific-test');
    const updatesDir = path.join(docDir, 'updates');
    fs.mkdirSync(updatesDir, { recursive: true });

    // Create stale tmp files simulating a crash.
    fs.writeFileSync(path.join(docDir, 'snapshot.bin.tmp'), 'stale');
    fs.writeFileSync(path.join(updatesDir, '0001.bin.tmp'), 'stale');

    const provider = new FilesystemProvider(opts());
    const doc = buildMockProviderDoc('specific-test');
    await provider.attach(doc);

    expect(fs.existsSync(path.join(docDir, 'snapshot.bin.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(updatesDir, '0001.bin.tmp'))).toBe(false);

    await provider.detach();
  });

  it('checkpointFullState writes snapshot and clears update log', async () => {
    const provider = new FilesystemProvider(opts());
    const doc = buildMockProviderDoc('specific-test');
    await provider.attach(doc);

    for (let i = 0; i < 5; i++) {
      provider.appendUpdate(makeUpdate(100 + i));
    }
    await provider.flush();

    const updatesDir = path.join(basePath, 'specific-test', 'updates');
    expect(fs.readdirSync(updatesDir).filter((f) => f.endsWith('.bin')).length).toBe(5);

    const result = await provider.checkpointFullState(doc);
    expect(result).toEqual({ status: 'committed', mode: 'normal' });

    const snapshotPath = path.join(basePath, 'specific-test', 'snapshot.bin');
    expect(fs.existsSync(snapshotPath)).toBe(true);
    expect(fs.readdirSync(updatesDir).filter((f) => f.endsWith('.bin')).length).toBe(0);

    await provider.detach();
  });

  it('flushSync writes update files synchronously', async () => {
    const provider = new FilesystemProvider(opts());
    const doc = buildMockProviderDoc('specific-test');
    await provider.attach(doc);

    provider.appendUpdate(makeUpdate(1));
    provider.appendUpdate(makeUpdate(2));
    provider.flushSync();

    const updatesDir = path.join(basePath, 'specific-test', 'updates');
    const files = fs.readdirSync(updatesDir).sort();
    expect(files).toEqual(['0001.bin', '0002.bin']);

    await provider.detach();
  });

  it('attach returns blocked when already attached', async () => {
    const provider = new FilesystemProvider(opts());
    const doc = buildMockProviderDoc('specific-test');
    await provider.attach(doc);

    const result = await provider.attach(doc);
    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'alreadyAttached',
    });

    await provider.detach();
  });

  it('attach returns blocked when detached', async () => {
    const provider = new FilesystemProvider(opts());
    const doc = buildMockProviderDoc('specific-test');
    await provider.attach(doc);
    await provider.detach();

    const result = await provider.attach(doc);
    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'detached',
    });
  });

  it('importInitialize mode skips replay', async () => {
    // Pre-populate some data.
    const provider1 = new FilesystemProvider(opts());
    const doc1 = buildMockProviderDoc('specific-test');
    await provider1.attach(doc1);
    provider1.appendUpdate(makeUpdate(1));
    provider1.appendUpdate(makeUpdate(2));
    await provider1.flush();
    await provider1.detach();

    // Re-attach with importInitialize.
    const provider2 = new FilesystemProvider(opts());
    const doc2 = buildMockProviderDoc('specific-test');
    const result = await provider2.attach(doc2, {
      kind: 'importInitialize',
      replaceExisting: true,
    });

    expect(result).toMatchObject({ status: 'ready', mode: 'importInitialize' });
    expect(doc2.appliedCount()).toBe(0);

    await provider2.detach();
  });

  it('storageCursor returns same bytes as stateVector', async () => {
    const provider = new FilesystemProvider(opts());
    const doc = buildMockProviderDoc('specific-test');
    await provider.attach(doc);

    provider.appendUpdate(makeUpdate(1));
    await provider.flush();

    const sv = await provider.stateVector();
    const cursor = await provider.storageCursor();
    expect(sv).toEqual(cursor);

    await provider.detach();
  });

  it('survives attach on stale lock from dead process', async () => {
    const docDir = path.join(basePath, 'specific-test');
    fs.mkdirSync(path.join(docDir, 'updates'), { recursive: true });
    // PID 999999999 is almost certainly not alive.
    fs.writeFileSync(path.join(docDir, 'lock.pid'), '999999999', 'utf-8');

    const provider = new FilesystemProvider(opts());
    const doc = buildMockProviderDoc('specific-test');
    const result = await provider.attach(doc);
    expect(result).toMatchObject({ status: 'ready' });

    const lockContents = fs.readFileSync(path.join(docDir, 'lock.pid'), 'utf-8');
    expect(parseInt(lockContents, 10)).toBe(process.pid);

    await provider.detach();
  });
});
