import {
  MogSdkVersionStoreConfigError,
  createSdkVersionStoreLifecycleConfig,
  type MogSdkVersionStoreLifecycleConfig,
} from '../src/version-store';

function captureVersionStoreConfigError(
  config: unknown,
  runtime: 'node' | 'wasm' = 'wasm',
): MogSdkVersionStoreConfigError {
  try {
    createSdkVersionStoreLifecycleConfig(config as never, { runtime });
  } catch (error) {
    if (error instanceof MogSdkVersionStoreConfigError) return error;
    throw error;
  }
  throw new Error('Expected version-store config to fail');
}

function expectPublicDomainSupportManifest(
  config: MogSdkVersionStoreLifecycleConfig | undefined,
  workbookId?: string,
): void {
  if (!config) throw new Error('Expected version-store lifecycle config');
  const manifest = config.domainSupportManifest;

  expect(manifest.schemaVersion).toBe('domain-support-manifest.v2');
  expect(manifest.domains.length).toBeGreaterThan(0);
  if (workbookId) {
    expect(manifest.workbookId).toBe(workbookId);
  } else {
    expect(manifest).not.toHaveProperty('workbookId');
  }
}

describe('SDK version-store config', () => {
  it('preserves absent config as the SDK default lifecycle path', () => {
    expect(createSdkVersionStoreLifecycleConfig(undefined, { runtime: 'node' })).toBeUndefined();
  });

  it('maps in-memory config to the memory provider selection', () => {
    const config = createSdkVersionStoreLifecycleConfig(
      { kind: 'in-memory', workspaceId: 'workspace-1', principalScope: 'principal-1' },
      { runtime: 'node', documentId: 'document-memory' },
    );

    expect(config?.providerSelection).toEqual({
      kind: 'memory',
      workspaceId: 'workspace-1',
      principalScope: 'principal-1',
    });
    expectPublicDomainSupportManifest(config, 'document-memory');
  });

  it('maps browser config to durable IndexedDB provider selection', () => {
    const config = createSdkVersionStoreLifecycleConfig(
      { kind: 'browser' },
      { runtime: 'wasm', documentId: 'document-browser' },
    );

    expect(config?.providerSelection).toEqual({
      kind: 'indexeddb',
      requireDurablePersistence: true,
    });
    expectPublicDomainSupportManifest(config, 'document-browser');
  });

  it('rejects non-canonical provider ids before selecting a provider', () => {
    for (const [config, field, canonicalField] of [
      ['IndexedDB', 'kind', 'canonicalKind'],
      [{ kind: 'indexedDB' }, 'kind', 'canonicalKind'],
      [{ kind: 'browser', provider: 'IndexedDB' }, 'provider', 'canonicalProvider'],
    ] as const) {
      const error = captureVersionStoreConfigError(config);
      expect(error).toMatchObject({
        diagnostic: {
          code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
          details: {
            field,
            category: 'provider-identity',
            [canonicalField]: 'indexeddb',
          },
        },
      });
    }
  });

  it('serializes public lifecycle config with stable field order', () => {
    const config = createSdkVersionStoreLifecycleConfig(
      {
        kind: 'browser',
        provider: 'indexeddb',
        principalScope: 'principal-1',
        readOnly: true,
        requireDurablePersistence: false,
        workspaceId: 'workspace-1',
      },
      { runtime: 'wasm', documentId: 'document-stable-order' },
    );

    expect(Object.keys(config ?? {})).toEqual(['providerSelection', 'domainSupportManifest']);
    expect(JSON.stringify(config?.providerSelection)).toBe(
      '{"kind":"indexeddb","workspaceId":"workspace-1","principalScope":"principal-1","readOnly":true,"requireDurablePersistence":false}',
    );
    expect(Object.keys(config?.domainSupportManifest ?? {}).slice(0, 3)).toEqual([
      'schemaVersion',
      'generatedAt',
      'workbookId',
    ]);
    expectPublicDomainSupportManifest(config, 'document-stable-order');
  });

  it('maps explicit IndexedDB config to the existing registry provider kind', () => {
    const config = createSdkVersionStoreLifecycleConfig(
      { kind: 'indexeddb', readOnly: true, requireDurablePersistence: false },
      { runtime: 'wasm', documentId: 'document-indexeddb' },
    );

    expect(config?.providerSelection).toEqual({
      kind: 'indexeddb',
      readOnly: true,
      requireDurablePersistence: false,
    });
    expectPublicDomainSupportManifest(config, 'document-indexeddb');
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

  it('fails closed for unsupported durable Node filesystem aliases without leaking paths', () => {
    for (const kind of ['file-system', 'node-filesystem', 'node:fs', 'fs'] as const) {
      const error = captureVersionStoreConfigError(
        { kind, path: `/tmp/mog-version-store/${kind}` },
        'node',
      );

      expect(error).toMatchObject({
        diagnostic: {
          code: 'MOG_SDK_VERSION_STORE_UNSUPPORTED',
          runtime: 'node',
          requestedKind: kind,
          details: {
            noFallbackToMemory: true,
            pathProvided: true,
          },
        },
      });
      expect(error.message).not.toContain('/tmp/mog-version-store');
      expect(JSON.stringify(error.diagnostic)).not.toContain('/tmp/mog-version-store');
    }
  });

  it('keeps unsupported arbitrary kind diagnostics value-safe', () => {
    const error = captureVersionStoreConfigError({
      kind: 'tenant-prod-provider-secret',
      path: '/tmp/tenant-prod-provider-secret',
    });

    expect(error).toMatchObject({
      diagnostic: {
        code: 'MOG_SDK_VERSION_STORE_UNSUPPORTED',
      },
    });
    expect(error.diagnostic.requestedKind).toBeUndefined();
    expect(error.diagnostic.safeMessage).not.toContain('tenant-prod-provider-secret');
    expect(error.message).not.toContain('tenant-prod-provider-secret');
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
      createSdkVersionStoreLifecycleConfig({ kind: 'memory', provider: 'indexeddb' } as never, {
        runtime: 'node',
      }),
    ).toThrow("versionStore.provider is only valid with kind='browser'");
  });

  it('rejects missing workspace authority for remote mode claims', () => {
    const error = captureVersionStoreConfigError({
      kind: 'indexeddb',
      mode: 'remoteBacked',
    });

    expect(error).toMatchObject({
      diagnostic: {
        code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
        requestedKind: 'indexeddb',
        details: {
          field: 'workspaceId',
          category: 'workspace-authority',
          claimedField: 'mode',
        },
      },
    });
  });

  it('rejects mixed local and remote mode overclaims even with workspace scope', () => {
    for (const [field, value] of [
      ['mode', 'localFirst'],
      ['remote', true],
      ['localFirst', true],
      ['remotePromote', true],
    ] as const) {
      const error = captureVersionStoreConfigError({
        kind: 'indexeddb',
        workspaceId: 'workspace-1',
        [field]: value,
      });
      expect(error).toMatchObject({
        diagnostic: {
          code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
          requestedKind: 'indexeddb',
          details: {
            field,
            category: 'mode-overclaim',
          },
        },
      });
    }
  });

  it('rejects provider authority fields from remote provenance', () => {
    for (const field of [
      'authorityRef',
      'stableOriginId',
      'remoteSessionId',
      'providerKind',
      'providerEpoch',
      'syncIdentity',
    ] as const) {
      const error = captureVersionStoreConfigError({
        kind: 'indexeddb',
        workspaceId: 'workspace-1',
        [field]: `${field}-1`,
      });
      expect(error).toMatchObject({
        diagnostic: {
          code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
          requestedKind: 'indexeddb',
          details: {
            field,
            category: 'provider-identity',
          },
        },
      });
    }
  });

  it('rejects malformed browser provider config', () => {
    const error = captureVersionStoreConfigError({
      kind: 'browser',
      provider: { kind: 'indexeddb' },
    });

    expect(error).toMatchObject({
      diagnostic: {
        code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
        runtime: 'wasm',
        requestedKind: 'browser',
        details: {
          field: 'provider',
          category: 'provider-identity',
        },
      },
    });
    expect(error.message).toContain("provider kind string 'indexeddb'");
  });

  it('rejects internal provider/openGraph config', () => {
    const error = captureVersionStoreConfigError({
      kind: 'indexeddb',
      openGraph: async () => undefined,
    });

    expect(error).toMatchObject({
      diagnostic: {
        code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
        requestedKind: 'indexeddb',
        details: {
          field: 'openGraph',
          category: 'provider-internal',
        },
      },
    });
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

  it('rejects storage namespace and backing store key aliases', () => {
    for (const field of [
      'storageNamespace',
      'registryStorageKey',
      'indexedDBName',
      'objectStoreKey',
    ] as const) {
      const error = captureVersionStoreConfigError({
        kind: 'indexeddb',
        workspaceId: 'workspace-1',
        [field]: `${field}-1`,
      });
      expect(error).toMatchObject({
        diagnostic: {
          code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
          requestedKind: 'indexeddb',
          details: {
            field,
            category: 'storage-key',
          },
        },
      });
    }
  });

  it('rejects workspace and remote authority aliases', () => {
    for (const field of [
      'workspace',
      'remoteWorkspaceId',
      'remoteAuthority',
      'collaborationAuthority',
    ] as const) {
      const error = captureVersionStoreConfigError({
        kind: 'indexeddb',
        workspaceId: 'workspace-1',
        [field]: `${field}-1`,
      });
      expect(error).toMatchObject({
        diagnostic: {
          code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
          requestedKind: 'indexeddb',
          details: {
            field,
            category: 'workspace-authority',
          },
        },
      });
    }
  });

  it('rejects private host source fields', () => {
    for (const [field, config] of [
      ['source', { kind: 'indexeddb', source: { type: 'bytes', data: new Uint8Array() } }],
      ['sourceKind', { kind: 'indexeddb', sourceKind: 'uploaded-bytes' }],
      ['sourceHostId', { kind: 'indexeddb', sourceHostId: 'sdk-host' }],
      [
        'resourceContext',
        {
          kind: 'indexeddb',
          resourceContext: { workspaceId: 'workspace-1', documentId: 'document-1' },
        },
      ],
      ['storage', { kind: 'indexeddb', storage: { sourceHostId: 'sdk-host' } }],
    ] as const) {
      const error = captureVersionStoreConfigError(config);
      expect(error).toMatchObject({
        diagnostic: {
          code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
          requestedKind: 'indexeddb',
          details: {
            field,
            category: 'internal-source',
          },
        },
      });
    }
  });

  it('rejects unknown fields instead of silently accepting them', () => {
    const error = captureVersionStoreConfigError({
      kind: 'indexeddb',
      unrecognizedDurabilityMode: 'best-effort',
    });

    expect(error).toMatchObject({
      diagnostic: {
        code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
        requestedKind: 'indexeddb',
        details: {
          field: 'unrecognizedDurabilityMode',
          category: 'unsupported-field',
        },
      },
    });
  });

  it('rejects stale default-on rollout flags', () => {
    for (const [field, value] of [
      ['defaultOn', true],
      ['enableDefaultVersioning', true],
      ['rolloutStage', 'default-on'],
      ['controlPlane', {}],
      ['featureGates', {}],
      ['casToken', 'token-1'],
      ['defaultProviderKind', 'indexeddb'],
    ] as const) {
      const error = captureVersionStoreConfigError({
        kind: 'indexeddb',
        workspaceId: 'workspace-1',
        [field]: value,
      });
      expect(error).toMatchObject({
        diagnostic: {
          code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
          requestedKind: 'indexeddb',
          details: {
            field,
            category: 'stale-default-flag',
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
