/**
 * @mog/test-host — Deterministic trusted test host for host-contract
 * integration testing.
 *
 * Workspace-private package. NOT re-exported by public @mog-sdk packages.
 */

export {
  createDeterministicDocumentHost,
  type DeterministicDocumentHost,
  type DeterministicDocumentHostOptions,
} from './document-host';

export { createDiagnosticsCapture, type DiagnosticsCapture } from './diagnostics';

export { createPrincipalFixtures, type PrincipalFixtures } from './identity';

export {
  createDeterministicIds,
  createDeterministicIdGenerator,
  type DeterministicIds,
  type DeterministicIdGenerator,
} from './ids';

export {
  createDeterministicReplayRegistry,
  createDeterministicProviderMaterializer,
  createDeterministicSourceHandleResolver,
  createDeterministicTransportBindings,
  createDeterministicAdapterBindings,
  type DeterministicReplayRegistry,
  type DeterministicProviderMaterializer,
  type DeterministicSourceHandleResolver,
  type DeterministicTransportBindings,
  type DeterministicAdapterBindings,
} from './storage';

// Re-export canonical binding types from @mog-sdk/types-host/bindings.
export type {
  HostKernelAdapterBindings,
  HostHandoffReplayRegistry,
  HandoffReplayKey,
  HostProviderMaterializerRegistry,
  ProviderMaterializerRequest,
  ProviderMaterializerHandle,
  HostSourceHandleResolverRegistry,
  SourceHandleResolveRequest,
  SourceHandleResolveResult,
  HostTransportBindingRegistry,
  HostTransportBinding,
} from '@mog-sdk/types-host/bindings';
