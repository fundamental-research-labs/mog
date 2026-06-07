/**
 * @mog/kernel-host-internal — workspace-private trusted-adapter entry package.
 *
 * This package provides the narrow entry point for host-backed document
 * construction. It is NOT a public `@mog-sdk/kernel` subpath. Trusted adapters
 * and test hosts import from this package; public packages expose their own
 * facade option types and authorize/narrow before entering this kernel path.
 *
 * `prepareHostBackedDocument()` validates the host context and returns the
 * `KernelDocumentLifecycleInput` that trusted adapters pass to
 * `DocumentLifecycleSystem` with `kind: 'host-backed'`.
 */

// Bindings — trusted composition capabilities
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
} from './bindings';

// Types — input and validated lifecycle types
export type {
  KernelHostDocumentInput,
  KernelDocumentLifecycleInput,
  HostSessionSnapshot,
  ValidatedAuthorizedStorageHandoff,
  ValidatedKernelRuntimeConfig,
  ValidatedHostKernelAdapterBindings,
  BoundHostDocumentOperationAuthorization,
} from './types';

// Validation gate
export { validateKernelHostContextForDocument } from './validate';

// Entry point — narrow trusted-adapter preparation
export { prepareHostBackedDocument } from './open';

// Host-backed document creation — full lifecycle: validate → create → ready → handle
export {
  createHeadlessDocument,
  createHostBackedCollaborationDocument,
  createHostBackedDocument,
  importHeadlessDocumentFromXlsx,
  importHostBackedDocument,
  importHostBackedInteractiveDeferredDocument,
  type CreateHostBackedCollaborationDocumentOptions,
  type CreateHostBackedDocumentOptions,
  type CreateHeadlessDocumentOptions,
  type DocumentSyncCapableHandle,
  type HeadlessDocumentImportOptions,
  type HostBackedCollaborationDocumentResult,
  type ImportHostBackedInteractiveDeferredDocumentOptions,
  type ImportHostBackedDocumentOptions,
  type TrustedCollaborationRoomDescriptor,
} from './create';

// Errors
export { HostContextConstructionError } from './errors';
