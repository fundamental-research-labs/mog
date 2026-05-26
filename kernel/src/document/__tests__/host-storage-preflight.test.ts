/**
 * Authorized Storage Preflight — unit tests.
 *
 * Verifies provider matching, required provider enforcement, ephemeral
 * zero-provider mode, durable fail-closed behavior, readiness targets,
 * and diagnostics emission for the host-backed storage preflight.
 */

import type { HostDiagnosticEvent, HostDiagnosticsSink } from '@mog-sdk/types-host/diagnostics';
import type { HostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';

import {
  preflightAuthorizedStorage,
  StoragePreflightError,
  type AuthorizedProviderSummary,
  type ProviderPreflightConfig,
  type StorageProviderConfig,
} from '../host-storage-preflight';

// =============================================================================
// Test fixtures
// =============================================================================

const TEST_FP: HostCanonicalFingerprint = 'mog-host-fp:v1:sha256:test-config-digest';

function createMockDiagnostics(): HostDiagnosticsSink & { events: HostDiagnosticEvent[] } {
  const events: HostDiagnosticEvent[] = [];
  return {
    events,
    emit(event: HostDiagnosticEvent) {
      events.push(event);
    },
  };
}

function makeAuthorizedProvider(
  overrides: Partial<AuthorizedProviderSummary> = {},
): AuthorizedProviderSummary {
  return {
    providerRefId: 'provider-1',
    kind: 'indexeddb',
    role: 'authority',
    required: false,
    rawByteExposure: 'kernel-internal-only',
    ...overrides,
  };
}

function makeStorageProvider(
  overrides: Partial<StorageProviderConfig> = {},
): StorageProviderConfig {
  return {
    providerRefId: 'provider-1',
    kind: 'indexeddb',
    role: 'authority',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ProviderPreflightConfig> = {}): ProviderPreflightConfig {
  return {
    authorizedProviders: [],
    storageProviders: [],
    durability: 'ephemeral',
    storageConstraint: 'as-requested',
    diagnostics: createMockDiagnostics(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('preflightAuthorizedStorage', () => {
  // ---------------------------------------------------------------------------
  // Ephemeral zero-provider mode
  // ---------------------------------------------------------------------------

  describe('ephemeral zero-provider mode', () => {
    it('succeeds when durability is ephemeral, authorizedProviders is empty, and storageProviders is empty', () => {
      const diagnostics = createMockDiagnostics();
      const result = preflightAuthorizedStorage(
        makeConfig({ durability: 'ephemeral', diagnostics }),
      );

      expect(result.mode).toBe('ephemeral-zero-provider');
      expect(result.matchedProviders).toEqual([]);
      expect(result.readinessTarget).toBe('readyEphemeral');

      // Diagnostics should have a success event
      expect(diagnostics.events.length).toBe(1);
      expect(diagnostics.events[0]).toMatchObject({
        kind: 'storage.failure',
        code: 'PREFLIGHT_EPHEMERAL_ZERO_PROVIDER',
        phase: 'preflight',
      });
    });

    it('falls through to provider matching when authorizedProviders is non-empty', () => {
      const diagnostics = createMockDiagnostics();
      // Ephemeral with authorized providers but no storage providers — the
      // authorized providers are optional so this should succeed as
      // provider-backed mode (no required providers fail).
      const result = preflightAuthorizedStorage(
        makeConfig({
          durability: 'ephemeral',
          authorizedProviders: [makeAuthorizedProvider({ required: false })],
          storageProviders: [],
          diagnostics,
        }),
      );

      // Not zero-provider mode since authorizedProviders is non-empty
      expect(result.mode).toBe('provider-backed');
    });

    it('falls through to provider matching when storageProviders is non-empty', () => {
      const diagnostics = createMockDiagnostics();
      // Ephemeral with storage providers but no authorized providers — should fail
      // because the storage provider can't match an authorized provider
      expect(() =>
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'ephemeral',
            authorizedProviders: [],
            storageProviders: [makeStorageProvider()],
            diagnostics,
          }),
        ),
      ).toThrow(StoragePreflightError);
    });
  });

  // ---------------------------------------------------------------------------
  // Provider matching
  // ---------------------------------------------------------------------------

  describe('provider matching', () => {
    it('matches by providerRefId + kind + role + authority + scope + fingerprint', () => {
      const diagnostics = createMockDiagnostics();
      const result = preflightAuthorizedStorage(
        makeConfig({
          durability: 'ephemeral',
          authorizedProviders: [
            makeAuthorizedProvider({
              providerRefId: 'p1',
              kind: 'indexeddb',
              role: 'authority',
              authorityRef: 'auth-ref-1',
              storageScope: {
                tenantId: 'tenant-1',
                workspaceId: 'ws-1',
                documentId: 'doc-1',
              },
              redactedConfigFingerprint: TEST_FP,
            }),
          ],
          storageProviders: [
            makeStorageProvider({
              providerRefId: 'p1',
              kind: 'indexeddb',
              role: 'authority',
              authorityRef: 'auth-ref-1',
              storageScope: {
                tenantId: 'tenant-1',
                workspaceId: 'ws-1',
                documentId: 'doc-1',
              },
              redactedConfigFingerprint: TEST_FP,
            }),
          ],
          diagnostics,
        }),
      );

      expect(result.mode).toBe('provider-backed');
      expect(result.matchedProviders).toHaveLength(1);
      expect(result.matchedProviders[0]).toEqual({
        providerRefId: 'p1',
        kind: 'indexeddb',
        role: 'authority',
        required: false,
        authorityRef: 'auth-ref-1',
        storageScope: {
          tenantId: 'tenant-1',
          workspaceId: 'ws-1',
          documentId: 'doc-1',
        },
        redactedConfigFingerprint: TEST_FP,
      });
    });

    it('fails when providerRefId is absent on storage config', () => {
      const diagnostics = createMockDiagnostics();
      expect(() =>
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'ephemeral',
            authorizedProviders: [
              makeAuthorizedProvider({
                providerRefId: 'auto-matched-1',
                kind: 'filesystem',
                role: 'cache',
              }),
            ],
            storageProviders: [
              makeStorageProvider({
                providerRefId: undefined as unknown as string,
                kind: 'filesystem',
                role: 'cache',
              }),
            ],
            diagnostics,
          }),
        ),
      ).toThrow(StoragePreflightError);

      expect(diagnostics.events).toContainEqual(
        expect.objectContaining({
          kind: 'storage.failure',
          code: 'PREFLIGHT_PROVIDER_REF_ID_MISSING',
        }),
      );
    });

    it('fails when provider kind does not match', () => {
      const diagnostics = createMockDiagnostics();
      expect(() =>
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'ephemeral',
            authorizedProviders: [
              makeAuthorizedProvider({
                providerRefId: 'p1',
                kind: 'indexeddb',
                role: 'authority',
              }),
            ],
            storageProviders: [
              makeStorageProvider({
                providerRefId: 'p1',
                kind: 'filesystem',
                role: 'authority',
              }),
            ],
            diagnostics,
          }),
        ),
      ).toThrow(StoragePreflightError);

      const errorEvents = diagnostics.events.filter(
        (e) =>
          e.kind === 'storage.failure' &&
          (e as { code: string }).code === 'PREFLIGHT_PROVIDER_KIND_MISMATCH',
      );
      expect(errorEvents.length).toBe(1);
    });

    it('fails when provider role does not match', () => {
      const diagnostics = createMockDiagnostics();
      expect(() =>
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'ephemeral',
            authorizedProviders: [
              makeAuthorizedProvider({
                providerRefId: 'p1',
                kind: 'indexeddb',
                role: 'authority',
              }),
            ],
            storageProviders: [
              makeStorageProvider({
                providerRefId: 'p1',
                kind: 'indexeddb',
                role: 'cache',
              }),
            ],
            diagnostics,
          }),
        ),
      ).toThrow(StoragePreflightError);

      const errorEvents = diagnostics.events.filter(
        (e) =>
          e.kind === 'storage.failure' &&
          (e as { code: string }).code === 'PREFLIGHT_PROVIDER_ROLE_MISMATCH',
      );
      expect(errorEvents.length).toBe(1);
    });

    it('fails when providerRefId is present but has no authorized match', () => {
      const diagnostics = createMockDiagnostics();
      expect(() =>
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'ephemeral',
            authorizedProviders: [makeAuthorizedProvider({ providerRefId: 'other-provider' })],
            storageProviders: [makeStorageProvider({ providerRefId: 'unknown-provider' })],
            diagnostics,
          }),
        ),
      ).toThrow(StoragePreflightError);

      try {
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'ephemeral',
            authorizedProviders: [makeAuthorizedProvider({ providerRefId: 'other-provider' })],
            storageProviders: [makeStorageProvider({ providerRefId: 'unknown-provider' })],
            diagnostics: createMockDiagnostics(),
          }),
        );
      } catch (e) {
        expect(e).toBeInstanceOf(StoragePreflightError);
        expect((e as StoragePreflightError).code).toBe('PROVIDER_NOT_AUTHORIZED');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Required provider enforcement
  // ---------------------------------------------------------------------------

  describe('required provider enforcement', () => {
    it('fails when a required authorized provider has no matching storage config', () => {
      const diagnostics = createMockDiagnostics();
      expect(() =>
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'ephemeral',
            authorizedProviders: [
              makeAuthorizedProvider({
                providerRefId: 'required-1',
                kind: 'indexeddb',
                role: 'authority',
                required: true,
              }),
            ],
            storageProviders: [],
            diagnostics,
          }),
        ),
      ).toThrow(StoragePreflightError);

      try {
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'ephemeral',
            authorizedProviders: [
              makeAuthorizedProvider({
                providerRefId: 'required-1',
                required: true,
              }),
            ],
            storageProviders: [],
            diagnostics: createMockDiagnostics(),
          }),
        );
      } catch (e) {
        expect(e).toBeInstanceOf(StoragePreflightError);
        expect((e as StoragePreflightError).code).toBe('REQUIRED_PROVIDER_UNMATCHED');
      }
    });

    it('succeeds when a non-required authorized provider has no matching storage config', () => {
      const result = preflightAuthorizedStorage(
        makeConfig({
          durability: 'ephemeral',
          authorizedProviders: [
            makeAuthorizedProvider({
              providerRefId: 'optional-1',
              required: false,
            }),
          ],
          storageProviders: [],
        }),
      );

      expect(result.mode).toBe('provider-backed');
      expect(result.matchedProviders).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Durable storage fail-closed
  // ---------------------------------------------------------------------------

  describe('durable storage fail-closed', () => {
    it('fails when durability is durable and there are zero matched providers', () => {
      const diagnostics = createMockDiagnostics();
      expect(() =>
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'durableLocal',
            authorizedProviders: [makeAuthorizedProvider({ required: false })],
            storageProviders: [],
            diagnostics,
          }),
        ),
      ).toThrow(StoragePreflightError);

      try {
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'durableLocal',
            authorizedProviders: [makeAuthorizedProvider({ required: false })],
            storageProviders: [],
            diagnostics: createMockDiagnostics(),
          }),
        );
      } catch (e) {
        expect(e).toBeInstanceOf(StoragePreflightError);
        expect((e as StoragePreflightError).code).toBe('DURABLE_STORAGE_NO_PROVIDERS');
      }
    });

    it('succeeds when durability is durable and providers are matched', () => {
      const result = preflightAuthorizedStorage(
        makeConfig({
          durability: 'durableLocal',
          authorizedProviders: [
            makeAuthorizedProvider({
              providerRefId: 'durable-1',
              kind: 'indexeddb',
              role: 'authority',
            }),
          ],
          storageProviders: [
            makeStorageProvider({
              providerRefId: 'durable-1',
              kind: 'indexeddb',
              role: 'authority',
            }),
          ],
        }),
      );

      expect(result.mode).toBe('provider-backed');
      expect(result.matchedProviders).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Readiness targets
  // ---------------------------------------------------------------------------

  describe('readiness targets', () => {
    it('returns readyReadWrite for as-requested storage constraint', () => {
      const result = preflightAuthorizedStorage(
        makeConfig({
          durability: 'ephemeral',
          storageConstraint: 'as-requested',
          authorizedProviders: [makeAuthorizedProvider()],
          storageProviders: [makeStorageProvider()],
        }),
      );
      expect(result.readinessTarget).toBe('readyReadWrite');
    });

    it('returns readyReadOnly for read-only storage constraint', () => {
      const result = preflightAuthorizedStorage(
        makeConfig({
          durability: 'ephemeral',
          storageConstraint: 'read-only',
          authorizedProviders: [makeAuthorizedProvider()],
          storageProviders: [makeStorageProvider()],
        }),
      );
      expect(result.readinessTarget).toBe('readyReadOnly');
    });

    it('returns readyEphemeral for ephemeral storage constraint', () => {
      const result = preflightAuthorizedStorage(
        makeConfig({
          durability: 'ephemeral',
          storageConstraint: 'ephemeral',
          authorizedProviders: [makeAuthorizedProvider()],
          storageProviders: [makeStorageProvider()],
        }),
      );
      expect(result.readinessTarget).toBe('readyEphemeral');
    });

    it('returns readyEphemeral for zero-provider ephemeral mode regardless of storageConstraint', () => {
      const result = preflightAuthorizedStorage(
        makeConfig({
          durability: 'ephemeral',
          storageConstraint: 'as-requested',
          authorizedProviders: [],
          storageProviders: [],
        }),
      );
      // Zero-provider ephemeral mode always returns readyEphemeral
      expect(result.readinessTarget).toBe('readyEphemeral');
    });
  });

  // ---------------------------------------------------------------------------
  // Diagnostics emission
  // ---------------------------------------------------------------------------

  describe('diagnostics', () => {
    it('emits success diagnostic for ephemeral zero-provider mode', () => {
      const diagnostics = createMockDiagnostics();
      preflightAuthorizedStorage(
        makeConfig({
          durability: 'ephemeral',
          diagnostics,
        }),
      );

      expect(diagnostics.events).toHaveLength(1);
      expect(diagnostics.events[0]).toMatchObject({
        kind: 'storage.failure',
        code: 'PREFLIGHT_EPHEMERAL_ZERO_PROVIDER',
      });
    });

    it('emits success diagnostic for provider-backed mode', () => {
      const diagnostics = createMockDiagnostics();
      preflightAuthorizedStorage(
        makeConfig({
          durability: 'ephemeral',
          authorizedProviders: [makeAuthorizedProvider()],
          storageProviders: [makeStorageProvider()],
          diagnostics,
        }),
      );

      expect(diagnostics.events).toHaveLength(1);
      expect(diagnostics.events[0]).toMatchObject({
        kind: 'storage.failure',
        code: 'PREFLIGHT_SUCCESS',
      });
    });

    it('emits failure diagnostic before throwing on kind mismatch', () => {
      const diagnostics = createMockDiagnostics();
      expect(() =>
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'ephemeral',
            authorizedProviders: [
              makeAuthorizedProvider({
                providerRefId: 'p1',
                kind: 'indexeddb',
                role: 'authority',
              }),
            ],
            storageProviders: [
              makeStorageProvider({
                providerRefId: 'p1',
                kind: 'filesystem',
                role: 'authority',
              }),
            ],
            diagnostics,
          }),
        ),
      ).toThrow(StoragePreflightError);

      expect(diagnostics.events.length).toBeGreaterThanOrEqual(1);
      expect(diagnostics.events[0]).toMatchObject({
        kind: 'storage.failure',
        code: 'PREFLIGHT_PROVIDER_KIND_MISMATCH',
        providerRefId: 'p1',
      });
    });

    it('emits failure diagnostic before throwing on required provider unmatched', () => {
      const diagnostics = createMockDiagnostics();
      expect(() =>
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'ephemeral',
            authorizedProviders: [
              makeAuthorizedProvider({
                providerRefId: 'req-1',
                required: true,
              }),
            ],
            storageProviders: [],
            diagnostics,
          }),
        ),
      ).toThrow(StoragePreflightError);

      expect(
        diagnostics.events.some(
          (e) =>
            e.kind === 'storage.failure' &&
            (e as { code: string }).code === 'PREFLIGHT_REQUIRED_PROVIDER_UNMATCHED',
        ),
      ).toBe(true);
    });

    it('emits failure diagnostic before throwing on durable with no providers', () => {
      const diagnostics = createMockDiagnostics();
      expect(() =>
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'durableLocal',
            authorizedProviders: [makeAuthorizedProvider({ required: false })],
            storageProviders: [],
            diagnostics,
          }),
        ),
      ).toThrow(StoragePreflightError);

      expect(
        diagnostics.events.some(
          (e) =>
            e.kind === 'storage.failure' &&
            (e as { code: string }).code === 'PREFLIGHT_DURABLE_NO_PROVIDERS',
        ),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple providers
  // ---------------------------------------------------------------------------

  describe('multiple providers', () => {
    it('matches multiple providers correctly', () => {
      const diagnostics = createMockDiagnostics();
      const result = preflightAuthorizedStorage(
        makeConfig({
          durability: 'durableLocal',
          storageConstraint: 'as-requested',
          authorizedProviders: [
            makeAuthorizedProvider({
              providerRefId: 'primary',
              kind: 'indexeddb',
              role: 'authority',
              required: true,
            }),
            makeAuthorizedProvider({
              providerRefId: 'cache',
              kind: 'memory',
              role: 'cache',
              required: false,
            }),
            makeAuthorizedProvider({
              providerRefId: 'sink',
              kind: 'objectStore',
              role: 'exportSink',
              required: false,
            }),
          ],
          storageProviders: [
            makeStorageProvider({
              providerRefId: 'primary',
              kind: 'indexeddb',
              role: 'authority',
            }),
            makeStorageProvider({
              providerRefId: 'cache',
              kind: 'memory',
              role: 'cache',
            }),
          ],
          diagnostics,
        }),
      );

      expect(result.mode).toBe('provider-backed');
      expect(result.matchedProviders).toHaveLength(2);
      expect(result.matchedProviders[0].providerRefId).toBe('primary');
      expect(result.matchedProviders[1].providerRefId).toBe('cache');
      expect(result.readinessTarget).toBe('readyReadWrite');
    });

    it('fails when one of multiple required providers is unmatched', () => {
      expect(() =>
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'durableLocal',
            authorizedProviders: [
              makeAuthorizedProvider({
                providerRefId: 'primary',
                kind: 'indexeddb',
                role: 'authority',
                required: true,
              }),
              makeAuthorizedProvider({
                providerRefId: 'collab',
                kind: 'remoteApi',
                role: 'replica',
                required: true,
              }),
            ],
            storageProviders: [
              makeStorageProvider({
                providerRefId: 'primary',
                kind: 'indexeddb',
                role: 'authority',
              }),
              // collab provider is missing
            ],
          }),
        ),
      ).toThrow(StoragePreflightError);

      try {
        preflightAuthorizedStorage(
          makeConfig({
            durability: 'durableLocal',
            authorizedProviders: [
              makeAuthorizedProvider({
                providerRefId: 'primary',
                kind: 'indexeddb',
                role: 'authority',
                required: true,
              }),
              makeAuthorizedProvider({
                providerRefId: 'collab',
                kind: 'remoteApi',
                role: 'replica',
                required: true,
              }),
            ],
            storageProviders: [
              makeStorageProvider({
                providerRefId: 'primary',
                kind: 'indexeddb',
                role: 'authority',
              }),
            ],
          }),
        );
      } catch (e) {
        expect((e as StoragePreflightError).code).toBe('REQUIRED_PROVIDER_UNMATCHED');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Error shape
  // ---------------------------------------------------------------------------

  describe('StoragePreflightError', () => {
    it('has the correct name and code', () => {
      const err = new StoragePreflightError('TEST_CODE', 'test message');
      expect(err.name).toBe('StoragePreflightError');
      expect(err.code).toBe('TEST_CODE');
      expect(err.message).toBe('test message');
      expect(err).toBeInstanceOf(Error);
    });
  });
});
