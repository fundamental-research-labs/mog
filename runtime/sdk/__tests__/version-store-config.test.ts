import {
  MogSdkVersionStoreConfigError,
  createSdkVersionStoreLifecycleConfig,
} from '../src/version-store';

describe('SDK version-store config', () => {
  it('maps in-memory config to the memory provider selection', () => {
    expect(
      createSdkVersionStoreLifecycleConfig(
        { kind: 'in-memory', workspaceId: 'workspace-1', principalScope: 'principal-1' },
        { runtime: 'node' },
      ),
    ).toEqual({
      providerSelection: {
        kind: 'memory',
        workspaceId: 'workspace-1',
        principalScope: 'principal-1',
      },
    });
  });

  it('maps browser config to durable IndexedDB provider selection', () => {
    expect(createSdkVersionStoreLifecycleConfig({ kind: 'browser' }, { runtime: 'wasm' })).toEqual({
      providerSelection: {
        kind: 'indexeddb',
        requireDurablePersistence: true,
      },
    });
  });

  it('maps explicit IndexedDB config to the existing registry provider kind', () => {
    expect(
      createSdkVersionStoreLifecycleConfig(
        { kind: 'indexeddb', readOnly: true, requireDurablePersistence: false },
        { runtime: 'wasm' },
      ),
    ).toEqual({
      providerSelection: {
        kind: 'indexeddb',
        readOnly: true,
        requireDurablePersistence: false,
      },
    });
  });

  it('fails closed for unsupported Node durable file config', () => {
    expect(() =>
      createSdkVersionStoreLifecycleConfig(
        { kind: 'node-file', path: '/tmp/mog-version-store' },
        { runtime: 'node' },
      ),
    ).toThrow(MogSdkVersionStoreConfigError);

    try {
      createSdkVersionStoreLifecycleConfig(
        { kind: 'node-file', path: '/tmp/mog-version-store' },
        { runtime: 'node' },
      );
    } catch (error) {
      expect(error).toMatchObject({
        diagnostic: {
          code: 'MOG_SDK_VERSION_STORE_UNSUPPORTED',
          runtime: 'node',
          requestedKind: 'node-file',
          details: {
            noFallbackToMemory: true,
            pathProvided: true,
          },
        },
      });
    }
  });

  it('rejects durable requirements on ephemeral memory config', () => {
    expect(() =>
      createSdkVersionStoreLifecycleConfig(
        { kind: 'memory', requireDurablePersistence: true } as never,
        { runtime: 'node' },
      ),
    ).toThrow('cannot satisfy requireDurablePersistence=true');
  });

  it('rejects ambiguous provider identity fields', () => {
    expect(() =>
      createSdkVersionStoreLifecycleConfig(
        { kind: 'indexeddb', providerId: 'provider-1' } as never,
        { runtime: 'wasm' },
      ),
    ).toThrow(MogSdkVersionStoreConfigError);

    try {
      createSdkVersionStoreLifecycleConfig(
        { kind: 'indexeddb', providerId: 'provider-1' } as never,
        { runtime: 'wasm' },
      );
    } catch (error) {
      expect(error).toMatchObject({
        diagnostic: {
          code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
          runtime: 'wasm',
          requestedKind: 'indexeddb',
          details: {
            field: 'providerId',
            category: 'provider-identity',
          },
        },
      });
    }
  });

  it('rejects provider selectors outside browser config', () => {
    expect(() =>
      createSdkVersionStoreLifecycleConfig(
        { kind: 'memory', provider: 'indexeddb' } as never,
        { runtime: 'node' },
      ),
    ).toThrow("versionStore.provider is only valid with kind='browser'");
  });

  it('rejects raw storage key material fields', () => {
    expect(() =>
      createSdkVersionStoreLifecycleConfig(
        { kind: 'indexeddb', storageKeyPrefix: 'tenant-a' } as never,
        { runtime: 'wasm' },
      ),
    ).toThrow(MogSdkVersionStoreConfigError);

    try {
      createSdkVersionStoreLifecycleConfig(
        { kind: 'indexeddb', storageKeyPrefix: 'tenant-a' } as never,
        { runtime: 'wasm' },
      );
    } catch (error) {
      expect(error).toMatchObject({
        diagnostic: {
          code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
          requestedKind: 'indexeddb',
          details: {
            field: 'storageKeyPrefix',
            category: 'storage-key',
          },
        },
      });
    }
  });

  it('rejects unsafe storage key material in scope strings', () => {
    expect(() =>
      createSdkVersionStoreLifecycleConfig(
        { kind: 'memory', workspaceId: 'workspace\u0000one' },
        { runtime: 'node' },
      ),
    ).toThrow('ASCII control characters are not allowed');
  });

  it('rejects document scope inside version-store config', () => {
    expect(() =>
      createSdkVersionStoreLifecycleConfig(
        { kind: 'indexeddb', documentId: 'document-1' } as never,
        { runtime: 'wasm' },
      ),
    ).toThrow('pass documentId to createWorkbook options instead');
  });
});

describe('SDK createWorkbook version-store validation', () => {
  it('rejects unsupported Node durable file config on the native entry', async () => {
    const { createWorkbook } = await import('../src/boot');

    await expect(
      createWorkbook({
        versionStore: { kind: 'node-file', path: '/tmp/mog-version-store' },
      }),
    ).rejects.toMatchObject({
      diagnostic: {
        code: 'MOG_SDK_VERSION_STORE_UNSUPPORTED',
        runtime: 'node',
        requestedKind: 'node-file',
        details: { noFallbackToMemory: true },
      },
    });
  });

  it('rejects unsupported Node durable file config on the WASM entry', async () => {
    const { createWorkbook } = await import('../src/wasm');

    await expect(
      createWorkbook({
        versionStore: { kind: 'node-file', path: '/tmp/mog-version-store' },
      }),
    ).rejects.toMatchObject({
      diagnostic: {
        code: 'MOG_SDK_VERSION_STORE_UNSUPPORTED',
        runtime: 'wasm',
        requestedKind: 'node-file',
        details: { noFallbackToMemory: true },
      },
    });
  });
});
