/**
 * Host-backed kernel document lifecycle types — re-exported from @mog-sdk/types-host/kernel.
 *
 * These validated/narrowed types are defined in the host contract package so
 * both kernel and kernel-host-internal can import them cleanly.
 */
export type {
  KernelHostDocumentInput,
  KernelDocumentLifecycleInput,
  HostSessionSnapshot,
  ValidatedAuthorizedStorageHandoff,
  ValidatedKernelRuntimeConfig,
  ValidatedHostKernelAdapterBindings,
  BoundHostDocumentOperationAuthorization,
} from '@mog-sdk/types-host/kernel';
