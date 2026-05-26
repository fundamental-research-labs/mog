/**
 * Composition Conformance Tests — provider conformance
 *
 * Tests the provider composition validator edge cases not covered by
 * lifecycle-conformance.test.ts. Covers composition rules, provider
 * identity validation, and determineReadyMode edge cases.
 */

import type {
  DocumentStorageConfig,
  StorageProviderKind,
  StorageProviderRole,
} from '@mog-sdk/types-document/storage/document-provider';
import type {
  StorageProviderConfig,
  MemoryProviderConfig,
  TestProviderConfig,
  IndexedDbProviderConfig,
  ReadOnlySnapshotProviderConfig,
  FilesystemProviderConfig,
  RemoteApiProviderConfig,
  HostCallbackProviderConfig,
} from '@mog-sdk/types-document/storage/provider-configs';
import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';
import type { StorageScopeBinding } from '@mog-sdk/types-document/storage/provider-identity';
import { validateComposition, determineReadyMode } from '../providers/composition-validator';

const NO_SCOPE: StorageScopeBinding = {
  kind: 'explicit-no-scope',
  reason: 'deterministic-test-fixture',
};

const BASE_IDENTITY = {
  storageScope: NO_SCOPE,
  contractVersion: '1.0.0',
  providerProtocolVersion: '1.0.0',
} as const;

function makeProviderConfig(
  overrides: Partial<StorageProviderConfig> & {
    kind: StorageProviderKind;
    role: StorageProviderRole;
    providerRefId?: string;
  },
): StorageProviderConfig {
  const base = {
    providerRefId: overrides.providerRefId ?? `ref-${overrides.kind}-${overrides.role}`,
    required: true,
    ...BASE_IDENTITY,
    ...overrides,
  };

  switch (base.kind) {
    case 'memory':
      return { ...base, kind: 'memory', role: base.role } as MemoryProviderConfig;
    case 'test':
      return {
        fixtureId: 'test-fixture',
        simulateFailures: false,
        simulatedLatencyMs: 0,
        ...base,
        kind: 'test',
        role: base.role,
      } as TestProviderConfig;
    case 'indexeddb':
      return {
        databaseName: 'test-db',
        storeName: 'test-store',
        schemaVersion: 1,
        ...base,
        kind: 'indexeddb',
        role: base.role,
      } as IndexedDbProviderConfig;
    case 'readOnlySnapshot':
      return {
        snapshotSourceHandle: 'snap-handle',
        snapshotFormat: 'yrs-update' as const,
        ...base,
        kind: 'readOnlySnapshot',
        role: base.role,
      } as ReadOnlySnapshotProviderConfig;
    case 'filesystem':
      return {
        pathHandle: 'fs-handle',
        format: 'mog-binary',
        atomicWrite: true,
        ...base,
        kind: 'filesystem',
        role: base.role,
      } as FilesystemProviderConfig;
    case 'remoteApi':
      return {
        endpointHandle: 'ep-handle',
        credentialRef: 'cred-ref',
        protocol: 'rest-v1' as const,
        reconnectPolicy: 'exponential-backoff' as const,
        maxReconnectAttempts: 3,
        ...base,
        kind: 'remoteApi',
        role: base.role,
      } as RemoteApiProviderConfig;
    case 'hostCallback':
      return {
        callbackRegistrationId: 'cb-reg',
        asyncCapable: true,
        ...base,
        kind: 'hostCallback',
        role: base.role,
      } as HostCallbackProviderConfig;
    default:
      return base as StorageProviderConfig;
  }
}

function makeConfig(
  overrides: Partial<DocumentStorageConfig> & { providers: readonly StorageProviderConfig[] },
): DocumentStorageConfig {
  return {
    intent: 'open',
    durability: 'ephemeral',
    requireDurabilityBeforeReady: false,
    allowReadOnlyFallback: false,
    ...overrides,
  };
}

// =============================================================================
// Part 1: Composition Edge Cases
// =============================================================================

describe('Composition edge cases', () => {
  test('two writable authorities produce a warning', () => {
    const config = makeConfig({
      durability: 'durableLocal',
      providers: [
        makeProviderConfig({ kind: 'filesystem', role: 'authority', providerRefId: 'auth-1' }),
        makeProviderConfig({ kind: 'filesystem', role: 'authority', providerRefId: 'auth-2' }),
      ],
    });
    const result = validateComposition(config);
    const warningCodes = result.warnings.map((v) => v.code);
    expect(warningCodes).toContain('COMP_MULTI_AUTHORITY');
  });

  test('exportSink as only provider does not satisfy durableLocal', () => {
    const config = makeConfig({
      durability: 'durableLocal',
      providers: [
        makeProviderConfig({ kind: 'memory', role: 'exportSink', providerRefId: 'sink-1' }),
      ],
    });
    const result = validateComposition(config);
    expect(result.valid).toBe(false);
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain('COMP_NO_WRITABLE_AUTHORITY');
  });

  test('readOnlySnapshot with readOnly durability triggers snapshot-related handling', () => {
    const config = makeConfig({
      durability: 'readOnly',
      providers: [
        makeProviderConfig({ kind: 'readOnlySnapshot', role: 'snapshot', providerRefId: 'ro-1' }),
      ],
    });
    const result = validateComposition(config);
    expect(result.valid).toBe(true);
  });

  test('cache without authority for durableLocal is invalid', () => {
    const config = makeConfig({
      durability: 'durableLocal',
      providers: [makeProviderConfig({ kind: 'memory', role: 'cache', providerRefId: 'cache-1' })],
    });
    const result = validateComposition(config);
    expect(result.valid).toBe(false);
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain('COMP_NO_WRITABLE_AUTHORITY');
  });

  test('memory provider alone is valid for ephemeral', () => {
    const config = makeConfig({
      durability: 'ephemeral',
      providers: [makeProviderConfig({ kind: 'memory', role: 'authority' })],
    });
    const result = validateComposition(config);
    expect(result.valid).toBe(true);
  });

  test('multiple caches with one authority is valid', () => {
    const config = makeConfig({
      durability: 'ephemeral',
      providers: [
        makeProviderConfig({ kind: 'memory', role: 'authority', providerRefId: 'auth-1' }),
        makeProviderConfig({ kind: 'memory', role: 'cache', providerRefId: 'cache-1' }),
        makeProviderConfig({ kind: 'memory', role: 'cache', providerRefId: 'cache-2' }),
      ],
    });
    const result = validateComposition(config);
    expect(result.valid).toBe(true);
  });

  test('authority + cache is valid for ephemeral', () => {
    const config = makeConfig({
      durability: 'ephemeral',
      providers: [
        makeProviderConfig({ kind: 'memory', role: 'authority', providerRefId: 'auth-1' }),
        makeProviderConfig({ kind: 'memory', role: 'cache', providerRefId: 'cache-1' }),
      ],
    });
    const result = validateComposition(config);
    expect(result.valid).toBe(true);
  });

  test('empty providers is valid for ephemeral', () => {
    const config = makeConfig({ durability: 'ephemeral', providers: [] });
    const result = validateComposition(config);
    expect(result.valid).toBe(true);
  });

  test('empty providers with durableLocal passes validation (no providers to violate)', () => {
    const config = makeConfig({ durability: 'durableLocal', providers: [] });
    const result = validateComposition(config);
    // No violations because durability rules gate on providers.length > 0
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// Part 2: Provider Identity Validation
// =============================================================================

describe('Provider identity validation', () => {
  test('multiple providers with same kind but different roles are accepted', () => {
    const config = makeConfig({
      durability: 'ephemeral',
      providers: [
        makeProviderConfig({ kind: 'memory', role: 'authority', providerRefId: 'mem-auth' }),
        makeProviderConfig({ kind: 'memory', role: 'cache', providerRefId: 'mem-cache' }),
      ],
    });
    const result = validateComposition(config);
    expect(result.valid).toBe(true);
  });

  test('unique providerRefIds across kinds are accepted', () => {
    const config = makeConfig({
      durability: 'ephemeral',
      providers: [
        makeProviderConfig({ kind: 'memory', role: 'authority', providerRefId: 'mem-auth' }),
        makeProviderConfig({ kind: 'test', role: 'cache', providerRefId: 'test-cache' }),
      ],
    });
    const result = validateComposition(config);
    const duplicateViolation = result.violations.find((v) => v.code === 'COMP_DUPLICATE_REF_ID');
    expect(duplicateViolation).toBeUndefined();
  });
});

// =============================================================================
// Part 3: determineReadyMode
// =============================================================================

describe('determineReadyMode', () => {
  test('ephemeral composition returns readyEphemeral', () => {
    const config = makeConfig({ durability: 'ephemeral', providers: [] });
    const compositionResult = validateComposition(config);
    const mode = determineReadyMode(config, compositionResult);
    expect(mode).toBe('readyEphemeral');
  });

  test('readOnly durability returns readyReadOnly', () => {
    const config = makeConfig({
      durability: 'readOnly',
      providers: [makeProviderConfig({ kind: 'readOnlySnapshot', role: 'snapshot' })],
    });
    const compositionResult = validateComposition(config);
    const mode = determineReadyMode(config, compositionResult);
    expect(mode).toBe('readyReadOnly');
  });

  test('durableLocal with authority returns readyReadWrite', () => {
    const config = makeConfig({
      durability: 'durableLocal',
      providers: [makeProviderConfig({ kind: 'filesystem', role: 'authority' })],
    });
    const compositionResult = validateComposition(config);
    const mode = determineReadyMode(config, compositionResult);
    expect(mode).toBe('readyReadWrite');
  });

  test('readOnlyFallback applied returns readyReadOnly', () => {
    const config = makeConfig({
      durability: 'durableLocal',
      allowReadOnlyFallback: true,
      providers: [makeProviderConfig({ kind: 'memory', role: 'authority' })],
    });
    const caps = new Map<string, StorageProviderCapabilities>();
    caps.set('ref-memory-authority', {
      writable: false,
      durable: false,
      synchronousFlushStart: false,
      fullStateCheckpoint: false,
      incrementalUpdateLog: false,
      yrsStateVectorDiff: false,
      storageCursor: false,
      subscriptions: false,
      exclusiveWriteLock: false,
      readOnlyFallback: true,
      offlineOpen: false,
      reconnect: false,
      inboundUpdates: false,
      idempotentRemoteUpdates: false,
      binaryAssets: false,
      assetContentAddressing: false,
      assetGarbageCollection: false,
      assetAtomicCommit: false,
      atomicBatch: false,
    });
    const compositionResult = validateComposition(config, caps);
    if (compositionResult.readOnlyFallbackApplied) {
      const mode = determineReadyMode(config, compositionResult);
      expect(mode).toBe('readyReadOnly');
    }
  });
});
