/**
 * HostKernelAdapterBindings — re-exported from @mog-sdk/types-host/bindings.
 *
 * These types are defined in the host contract package so both kernel and
 * kernel-host-internal can import them without cross-package boundary violations.
 */
export type {
  HostKernelAdapterBindings,
  HostProviderMaterializerRegistry,
  ProviderMaterializerRequest,
  ProviderMaterializerHandle,
  HostSourceHandleResolverRegistry,
  SourceHandleResolveRequest,
  SourceHandleResolveResult,
  HostHandoffReplayRegistry,
  HandoffReplayKey,
  HostTransportBindingRegistry,
  HostTransportBinding,
} from '@mog-sdk/types-host/bindings';
