/**
 * Integration test: Host-backed document construction path.
 *
 * Proves the complete contract chain works end-to-end without production
 * adapters or a real compute engine. Uses the deterministic test host.
 *
 * Flow: createDeterministicDocumentHost()
 *   -> validateKernelHostContextForDocument()
 *   -> projectAndVerifyPrincipal()
 *   -> createHostPrincipalLock()
 *   -> preflightAuthorizedStorage()
 *   -> createHostDocumentOperationGate()
 *
 * Each step consumes the output of the previous step, proving the contract
 * layers compose without shims or casts beyond the binding adapter.
 */

import { createDeterministicDocumentHost, type DeterministicDocumentHost } from '@mog/test-host';
import {
  validateKernelHostContextForDocument,
  type KernelDocumentLifecycleInput,
  type HostKernelAdapterBindings,
} from '@mog/kernel-host-internal';
import {
  projectAndVerifyPrincipal,
  PrincipalProjectionError,
} from '../../context/principal-projection';
import {
  createHostPrincipalLock,
  HostPrincipalMutationError,
} from '../../context/host-principal-lock';
import { createHostDocumentOperationGate, OperationDeniedError } from '../host-operation-gate';
import { preflightAuthorizedStorage, StoragePreflightError } from '../host-storage-preflight';

// ---------------------------------------------------------------------------
// Adapter: bridge test-host stub bindings to kernel-host-internal interface
// ---------------------------------------------------------------------------
//
// The test host's `_bindings-stub.ts` defines transport/provider/resolver
// registries with `getBinding()`/`resolve()` instead of the canonical
// kernel-host-internal `has()`/`resolve()` shape.  This thin adapter lifts
// the test-host bindings into the shape `validateKernelHostContextForDocument`
// expects, without modifying the test-host package.
//

function adaptBindings(raw: DeterministicDocumentHost['bindings']): HostKernelAdapterBindings {
  return {
    replayRegistry: raw.replayRegistry,
    providerMaterializers: {
      has(providerRefId: string): boolean {
        // The deterministic provider materializer resolves for 'memory',
        // 'indexeddb', and 'filesystem' kinds, but `has()` here is a
        // per-providerRefId probe.  In the zero-provider ephemeral test
        // path there are no providers, so this is a no-op.  For the
        // positive adapter case, return true — the deterministic materializer
        // will always attempt resolution.
        return true;
      },
      resolve: raw.providerMaterializers
        .resolve as HostKernelAdapterBindings['providerMaterializers']['resolve'],
    },
    sourceHandleResolvers: {
      has(sourceKind: string): boolean {
        return (
          sourceKind === 'file-url' ||
          sourceKind === 'uploaded-bytes' ||
          sourceKind === 'host-callback'
        );
      },
      resolve: raw.sourceHandleResolvers
        .resolve as HostKernelAdapterBindings['sourceHandleResolvers']['resolve'],
    },
    transportBindings: {
      has(runtimeKind: string): boolean {
        return runtimeKind === 'test';
      },
      resolve(runtimeKind: string) {
        if (runtimeKind !== 'test') {
          throw new Error(`No transport binding for runtime kind '${runtimeKind}'`);
        }
        return {
          runtimeKind: 'test',
          createTransportConfig: () => ({ kind: 'test' }),
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createHostAndValidate(options?: Parameters<typeof createDeterministicDocumentHost>[0]): {
  host: DeterministicDocumentHost;
  lifecycleInput: KernelDocumentLifecycleInput;
} {
  const host = createDeterministicDocumentHost(options);
  const bindings = adaptBindings(host.bindings);
  const lifecycleInput = validateKernelHostContextForDocument(host.kernelContext, bindings);
  return { host, lifecycleInput };
}

// =============================================================================
// Tests
// =============================================================================

describe('Host-backed document construction integration', () => {
  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  describe('happy path: create ephemeral document', () => {
    it('validates host context and produces lifecycle input', () => {
      const { lifecycleInput } = createHostAndValidate();

      expect(lifecycleInput.kind).toBe('host-backed-document');
      expect(lifecycleInput.documentId).toBe('test-doc-001');
      expect(lifecycleInput.operation).toBe('create');
    });

    it('freezes the resolved transport binding into lifecycle input', () => {
      const host = createDeterministicDocumentHost();
      let resolveCount = 0;
      const bindings = adaptBindings(host.bindings);
      const lifecycleInput = validateKernelHostContextForDocument(host.kernelContext, {
        ...bindings,
        transportBindings: {
          has: bindings.transportBindings.has,
          resolve(runtimeKind) {
            resolveCount += 1;
            return {
              runtimeKind,
              createTransportConfig: () => ({ kind: 'test', marker: `transport-${resolveCount}` }),
            };
          },
        },
      });

      expect(resolveCount).toBe(1);
      expect(lifecycleInput.runtime.transportBinding.runtimeKind).toBe('test');
      expect(lifecycleInput.runtime.transportBinding.createTransportConfig()).toEqual({
        kind: 'test',
        marker: 'transport-1',
      });
      expect(lifecycleInput.runtime.transportConfig).toEqual({
        kind: 'test',
        marker: 'transport-1',
      });
    });

    it('rejects transport bindings that omit the authoritative transport kind', () => {
      const host = createDeterministicDocumentHost();
      const bindings = adaptBindings(host.bindings);

      expect(() => {
        validateKernelHostContextForDocument(host.kernelContext, {
          ...bindings,
          transportBindings: {
            has: () => true,
            resolve: (runtimeKind) => ({
              runtimeKind,
              createTransportConfig: () => ({}),
            }),
          },
        });
      }).toThrow();
      try {
        validateKernelHostContextForDocument(host.kernelContext, {
          ...bindings,
          transportBindings: {
            has: () => true,
            resolve: (runtimeKind) => ({
              runtimeKind,
              createTransportConfig: () => ({}),
            }),
          },
        });
      } catch (err) {
        expect(err).toMatchObject({ code: 'TRANSPORT_BINDING_CONFIG_MISMATCH' });
      }
    });

    it('accepts headless-wasm host bindings with headless transport config', () => {
      const host = createDeterministicDocumentHost();
      const bindings = adaptBindings(host.bindings);
      const wasmModule = {} as WebAssembly.Module;
      const lifecycleInput = validateKernelHostContextForDocument(
        {
          ...host.kernelContext,
          runtime: {
            kind: 'headless-wasm',
            wasmModulePolicy: 'host-provided',
            executionPolicy: 'same-thread',
          },
        },
        {
          ...bindings,
          transportBindings: {
            has: (runtimeKind) => runtimeKind === 'headless-wasm',
            resolve: (runtimeKind) => ({
              runtimeKind,
              createTransportConfig: () => ({
                kind: 'headless',
                explicitRuntime: 'wasm',
                wasmModule,
              }),
            }),
          },
        },
      );

      expect(lifecycleInput.runtime.config.kind).toBe('headless-wasm');
      expect(lifecycleInput.runtime.transportConfig).toMatchObject({
        kind: 'headless',
        explicitRuntime: 'wasm',
        wasmModule,
      });
    });

    it('rejects headless-wasm bindings with non-headless transport config', () => {
      const host = createDeterministicDocumentHost();
      const bindings = adaptBindings(host.bindings);

      expect(() =>
        validateKernelHostContextForDocument(
          {
            ...host.kernelContext,
            runtime: {
              kind: 'headless-wasm',
              wasmModulePolicy: 'host-provided',
              executionPolicy: 'same-thread',
            },
          },
          {
            ...bindings,
            transportBindings: {
              has: () => true,
              resolve: (runtimeKind) => ({
                runtimeKind,
                createTransportConfig: () => ({
                  kind: 'browser',
                  explicitRuntime: 'wasm',
                }),
              }),
            },
          },
        ),
      ).toThrow();
    });

    it('rejects missing storage with a structured construction error', () => {
      const host = createDeterministicDocumentHost();
      const bindings = adaptBindings(host.bindings);

      expect(() =>
        validateKernelHostContextForDocument(
          { ...host.kernelContext, storage: undefined } as unknown as Parameters<
            typeof validateKernelHostContextForDocument
          >[0],
          bindings,
        ),
      ).toThrow();

      try {
        validateKernelHostContextForDocument(
          { ...host.kernelContext, storage: undefined } as unknown as Parameters<
            typeof validateKernelHostContextForDocument
          >[0],
          bindings,
        );
      } catch (err) {
        expect(err).toMatchObject({ code: 'MISSING_STORAGE', field: 'storage' });
      }
    });

    it('rejects transport bindings that resolve to a different runtime kind', () => {
      const host = createDeterministicDocumentHost();
      const bindings = adaptBindings(host.bindings);

      expect(() => {
        validateKernelHostContextForDocument(host.kernelContext, {
          ...bindings,
          transportBindings: {
            has: () => true,
            resolve: () => ({
              runtimeKind: 'node-napi',
              createTransportConfig: () => ({}),
            }),
          },
        });
      }).toThrow();
      try {
        validateKernelHostContextForDocument(host.kernelContext, {
          ...bindings,
          transportBindings: {
            has: () => true,
            resolve: () => ({
              runtimeKind: 'node-napi',
              createTransportConfig: () => ({}),
            }),
          },
        });
      } catch (err) {
        expect(err).toMatchObject({ code: 'TRANSPORT_BINDING_MISMATCH' });
      }
    });

    it('projects principal into handoff', () => {
      const { lifecycleInput } = createHostAndValidate();

      const principalHandoff = projectAndVerifyPrincipal({
        principal: lifecycleInput.principal,
        sessionTenantId: lifecycleInput.session.tenantId,
        sessionWorkspaceId: lifecycleInput.session.workspaceId,
        documentId: lifecycleInput.documentId,
        diagnostics: lifecycleInput.diagnostics,
      });

      expect(principalHandoff.verified).toBe(lifecycleInput.principal);
      expect(principalHandoff.canonicalTags).toEqual([...lifecycleInput.principal.tags].sort());
    });

    it('locks principal after projection', () => {
      const { lifecycleInput } = createHostAndValidate();

      const principalHandoff = projectAndVerifyPrincipal({
        principal: lifecycleInput.principal,
        sessionTenantId: lifecycleInput.session.tenantId,
        sessionWorkspaceId: lifecycleInput.session.workspaceId,
        documentId: lifecycleInput.documentId,
        diagnostics: lifecycleInput.diagnostics,
      });

      const lock = createHostPrincipalLock(principalHandoff);
      expect(lock.isLocked).toBe(true);
      expect(lock.lockedPrincipal).toBe(principalHandoff);
      expect(() => lock.assertNotLocked('setActivePrincipal')).toThrow(HostPrincipalMutationError);
    });

    it('preflights ephemeral zero-provider storage', () => {
      const { lifecycleInput } = createHostAndValidate();

      const handoff = lifecycleInput.storage.handoff;
      const preflight = preflightAuthorizedStorage({
        authorizedProviders: [...(handoff.authorizedProviders ?? [])],
        storageProviders: [...(handoff.storage?.providers ?? [])],
        durability: (handoff.storage?.durability as 'ephemeral' | 'durableLocal') ?? 'ephemeral',
        storageConstraint: handoff.storageConstraint,
        diagnostics: lifecycleInput.diagnostics,
      });

      expect(preflight.mode).toBe('ephemeral-zero-provider');
      expect(preflight.readinessTarget).toBe('readyEphemeral');
      expect(preflight.matchedProviders).toHaveLength(0);
    });

    it('installs operation gate and delegates export authorization', async () => {
      const { lifecycleInput } = createHostAndValidate();

      const gate = createHostDocumentOperationGate({
        sessionId: lifecycleInput.session.sessionId,
        sourceHostId: lifecycleInput.operationAuthorization.sourceHostId,
        principalFingerprint: lifecycleInput.operationAuthorization.principalFingerprint,
        resourceContextFingerprint:
          lifecycleInput.operationAuthorization.resourceContextFingerprint,
        principal: lifecycleInput.principal,
        resourceContext: lifecycleInput.resourceContext,
        documentAuthorization: {
          authorize: async () => ({
            allowed: false,
            decisionId: 'export-denied',
            correlationId: 'export-correlation',
            decidedAt: lifecycleInput.clock.now(),
            code: 'EXPORT_DENIED_BY_TEST_POLICY',
            reason: 'Denied by test policy',
          }),
        },
        replayRegistry: lifecycleInput.operationAuthorization.replayRegistry,
        diagnostics: lifecycleInput.diagnostics,
        clock: lifecycleInput.clock,
      });

      expect(gate.installed).toBe(true);

      await expect(
        gate.authorizeExport({
          format: 'xlsx',
          destination: 'download',
          exportPathId: 'test-export',
          documentHighWaterMark: {} as any,
          requestedExportSinkRefs: [],
          contentPolicy: {
            kind: 'authorized-raw-snapshot',
            rawMaterializationProof: {} as any,
          },
        }),
      ).rejects.toThrow(OperationDeniedError);
    });

    it('complete chain composes without error', () => {
      // Run the full sequence in a single test to prove composition
      const host = createDeterministicDocumentHost();
      const bindings = adaptBindings(host.bindings);

      // Step 1: Validate
      const lifecycleInput = validateKernelHostContextForDocument(host.kernelContext, bindings);
      expect(lifecycleInput.kind).toBe('host-backed-document');

      // Step 2: Project principal
      const principalHandoff = projectAndVerifyPrincipal({
        principal: lifecycleInput.principal,
        sessionTenantId: lifecycleInput.session.tenantId,
        sessionWorkspaceId: lifecycleInput.session.workspaceId,
        documentId: lifecycleInput.documentId,
        diagnostics: lifecycleInput.diagnostics,
      });
      expect(principalHandoff.verified).toBe(lifecycleInput.principal);

      // Step 3: Lock principal
      const lock = createHostPrincipalLock(principalHandoff);
      expect(lock.isLocked).toBe(true);

      // Step 4: Preflight storage
      const handoff = lifecycleInput.storage.handoff;
      const preflight = preflightAuthorizedStorage({
        authorizedProviders: [...(handoff.authorizedProviders ?? [])],
        storageProviders: [...(handoff.storage?.providers ?? [])],
        durability: (handoff.storage?.durability as 'ephemeral' | 'durableLocal') ?? 'ephemeral',
        storageConstraint: handoff.storageConstraint,
        diagnostics: lifecycleInput.diagnostics,
      });
      expect(preflight.mode).toBe('ephemeral-zero-provider');

      // Step 5: Install operation gate
      const gate = createHostDocumentOperationGate({
        sessionId: lifecycleInput.session.sessionId,
        sourceHostId: lifecycleInput.operationAuthorization.sourceHostId,
        principalFingerprint: lifecycleInput.operationAuthorization.principalFingerprint,
        resourceContextFingerprint:
          lifecycleInput.operationAuthorization.resourceContextFingerprint,
        principal: lifecycleInput.principal,
        resourceContext: lifecycleInput.resourceContext,
        documentAuthorization: lifecycleInput.operationAuthorization.documentAuthorization,
        replayRegistry: lifecycleInput.operationAuthorization.replayRegistry,
        diagnostics: lifecycleInput.diagnostics,
        clock: lifecycleInput.clock,
      });
      expect(gate.installed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  describe('diagnostics', () => {
    it('emits validation success diagnostic', () => {
      const host = createDeterministicDocumentHost();
      const bindings = adaptBindings(host.bindings);

      validateKernelHostContextForDocument(host.kernelContext, bindings);

      // The validation gate emits a success event with code HOST_VALIDATION_SUCCESS
      expect(host.diagnostics.events.length).toBeGreaterThan(0);
      const successEvents = host.diagnostics.events.filter(
        (e) => 'code' in e && (e as { code: string }).code === 'HOST_VALIDATION_SUCCESS',
      );
      expect(successEvents.length).toBeGreaterThan(0);
    });

    it('emits principal projection success diagnostic', () => {
      const { host, lifecycleInput } = createHostAndValidate();

      projectAndVerifyPrincipal({
        principal: lifecycleInput.principal,
        sessionTenantId: lifecycleInput.session.tenantId,
        sessionWorkspaceId: lifecycleInput.session.workspaceId,
        documentId: lifecycleInput.documentId,
        diagnostics: lifecycleInput.diagnostics,
      });

      const projectionEvents = host.diagnostics.events.filter(
        (e) => 'code' in e && (e as { code: string }).code === 'PRINCIPAL_PROJECTION_OK',
      );
      expect(projectionEvents.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Negative paths
  // ---------------------------------------------------------------------------

  describe('negative paths', () => {
    it('rejects expired storage handoff', () => {
      const host = createDeterministicDocumentHost({
        expireHandoffAfterMs: -1000, // already expired
      });
      const bindings = adaptBindings(host.bindings);

      expect(() => validateKernelHostContextForDocument(host.kernelContext, bindings)).toThrow(
        /expired/i,
      );
    });

    it('rejects forged owner principal (external issuer + mog: tag)', () => {
      // An external issuer should not be able to assert mog:owner tags.
      // The test host's issuerKind defaults to 'test' which is trusted.
      // We set issuerKind to a non-trusted value to test the rejection.
      const host = createDeterministicDocumentHost({
        issuerKind: 'test', // 'test' is trusted, so validation passes
        principalTags: ['mog:owner'],
      });
      const bindings = adaptBindings(host.bindings);

      // Validation itself succeeds — the rejection happens at principal projection
      const lifecycleInput = validateKernelHostContextForDocument(host.kernelContext, bindings);

      // Now create a tampered principal with an untrusted issuer
      const tamperedPrincipal = {
        ...lifecycleInput.principal,
        issuer: {
          issuerId: 'external-attacker',
          issuerKind: 'external' as 'test', // force the type
        },
      };

      expect(() =>
        projectAndVerifyPrincipal({
          principal: tamperedPrincipal,
          sessionTenantId: lifecycleInput.session.tenantId,
          sessionWorkspaceId: lifecycleInput.session.workspaceId,
          documentId: lifecycleInput.documentId,
          diagnostics: lifecycleInput.diagnostics,
        }),
      ).toThrow(PrincipalProjectionError);
    });

    it('rejects durable storage with no providers', () => {
      const host = createDeterministicDocumentHost({
        durability: 'durableLocal',
      });
      const bindings = adaptBindings(host.bindings);

      expect(() => validateKernelHostContextForDocument(host.kernelContext, bindings)).toThrow(
        /requires at least one authorized provider/i,
      );
    });

    it('allows typed remote provider credentialRef values', () => {
      const host = createDeterministicDocumentHost();
      const bindings = adaptBindings(host.bindings);
      const provider = {
        providerRefId: 'remote-primary',
        kind: 'remoteApi',
        role: 'authority',
        required: true,
        rawByteExposure: 'trusted-provider-boundary',
      } as const;

      const kernelContext = {
        ...host.kernelContext,
        storage: {
          ...host.kernelContext.storage,
          storageConstraint: 'as-requested' as const,
          authorizedProviders: [provider],
          storage: {
            intent: 'create' as const,
            durability: 'durableLocal' as const,
            requireDurabilityBeforeReady: true,
            allowReadOnlyFallback: false,
            providers: [
              {
                ...provider,
                endpointHandle: 'endpoint-ref:remote-primary',
                credentialRef: 'credential-ref:remote-primary',
                protocol: 'rest-v1' as const,
                reconnectPolicy: 'exponential-backoff' as const,
                maxReconnectAttempts: 3,
              },
            ],
          },
        },
      };

      expect(() => validateKernelHostContextForDocument(kernelContext, bindings)).not.toThrow();
    });

    it('rejects raw secrets in typed remote provider credentialRef values', () => {
      const host = createDeterministicDocumentHost();
      const bindings = adaptBindings(host.bindings);
      const provider = {
        providerRefId: 'remote-primary',
        kind: 'remoteApi',
        role: 'authority',
        required: true,
        rawByteExposure: 'trusted-provider-boundary',
      } as const;

      const kernelContext = {
        ...host.kernelContext,
        storage: {
          ...host.kernelContext.storage,
          storageConstraint: 'as-requested' as const,
          authorizedProviders: [provider],
          storage: {
            intent: 'create' as const,
            durability: 'durableLocal' as const,
            requireDurabilityBeforeReady: true,
            allowReadOnlyFallback: false,
            providers: [
              {
                ...provider,
                endpointHandle: 'endpoint-ref:remote-primary',
                credentialRef: 'sk_live_abcdefghijklmnopqrstuvwxyz0123456789',
                protocol: 'rest-v1' as const,
                reconnectPolicy: 'exponential-backoff' as const,
                maxReconnectAttempts: 3,
              },
            ],
          },
        },
      };

      expect(() => validateKernelHostContextForDocument(kernelContext, bindings)).toThrow(
        /raw secret-like value/i,
      );
    });

    it('replayed nonce is rejected', () => {
      const host = createDeterministicDocumentHost();
      const bindings = adaptBindings(host.bindings);

      // First call succeeds — consumes the nonce
      validateKernelHostContextForDocument(host.kernelContext, bindings);

      // Second call with same context fails — nonce already consumed
      expect(() => validateKernelHostContextForDocument(host.kernelContext, bindings)).toThrow(
        /replay protection failed|already consumed/i,
      );
    });

    it('locked principal rejects mutation attempts', () => {
      const { lifecycleInput } = createHostAndValidate();

      const principalHandoff = projectAndVerifyPrincipal({
        principal: lifecycleInput.principal,
        sessionTenantId: lifecycleInput.session.tenantId,
        sessionWorkspaceId: lifecycleInput.session.workspaceId,
        documentId: lifecycleInput.documentId,
        diagnostics: lifecycleInput.diagnostics,
      });

      const lock = createHostPrincipalLock(principalHandoff);

      // Every mutation operation should be rejected
      for (const op of ['setActivePrincipal', 'addTag', 'removeTag', 'clearSecurity']) {
        expect(() => lock.assertNotLocked(op)).toThrow(HostPrincipalMutationError);
        expect(() => lock.assertNotLocked(op)).toThrow(/host-backed workbook/);
      }
    });

    it('export operation delegates every format to host policy', async () => {
      const { lifecycleInput } = createHostAndValidate();

      const gate = createHostDocumentOperationGate({
        sessionId: lifecycleInput.session.sessionId,
        sourceHostId: lifecycleInput.operationAuthorization.sourceHostId,
        principalFingerprint: lifecycleInput.operationAuthorization.principalFingerprint,
        resourceContextFingerprint:
          lifecycleInput.operationAuthorization.resourceContextFingerprint,
        principal: lifecycleInput.principal,
        resourceContext: lifecycleInput.resourceContext,
        documentAuthorization: {
          authorize: async () => ({
            allowed: false,
            decisionId: 'export-denied',
            correlationId: 'export-correlation',
            decidedAt: lifecycleInput.clock.now(),
            code: 'EXPORT_DENIED_BY_TEST_POLICY',
            reason: 'Denied by test policy',
          }),
        },
        replayRegistry: lifecycleInput.operationAuthorization.replayRegistry,
        diagnostics: lifecycleInput.diagnostics,
        clock: lifecycleInput.clock,
      });

      for (const format of ['xlsx', 'csv', 'pdf', 'snapshot'] as const) {
        await expect(
          gate.authorizeExport({
            format,
            destination: 'download',
            exportPathId: `test-${format}`,
            documentHighWaterMark: {} as any,
            requestedExportSinkRefs: [],
            contentPolicy: {
              kind: 'authorized-raw-snapshot',
              rawMaterializationProof: {} as any,
            },
          }),
        ).rejects.toThrow(OperationDeniedError);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Custom document IDs and session options
  // ---------------------------------------------------------------------------

  describe('custom options flow through', () => {
    it('custom document ID propagates through the chain', () => {
      const { lifecycleInput } = createHostAndValidate({
        documentId: 'custom-doc-99',
      });

      expect(lifecycleInput.documentId).toBe('custom-doc-99');
      expect(lifecycleInput.resourceContext.documentId).toBe('custom-doc-99');
    });

    it('open operation propagates through the chain', () => {
      const { lifecycleInput } = createHostAndValidate({
        operation: 'open',
      });

      expect(lifecycleInput.operation).toBe('open');
    });

    it('custom session IDs propagate', () => {
      const { lifecycleInput } = createHostAndValidate({
        sessionId: 'custom-session-42',
        tenantId: 'acme-corp',
        workspaceId: 'ws-engineering',
      });

      expect(lifecycleInput.session.sessionId).toBe('custom-session-42');
      expect(lifecycleInput.session.tenantId).toBe('acme-corp');
      expect(lifecycleInput.session.workspaceId).toBe('ws-engineering');
    });
  });
});
