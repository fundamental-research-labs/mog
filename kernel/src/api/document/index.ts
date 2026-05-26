/**
 * Document lifecycle — creation and import.
 *
 * @stability internal
 * Monorepo-only. External SDK consumers should use createWorkbook() (zero-ceremony)
 * or MogDocumentFactory (document-first). Direct DocumentFactory / DocumentHandle
 * usage is reserved for kernel internals and monorepo integration.
 */
export {
  DocumentFactory,
  _createDocumentHandleInternal,
  type CollaborationPresenceState,
  type CollaborationSidecar,
  type CollaborationSidecarConfig,
  type CollaborationSidecarStatus,
  type DocumentHandle,
  type DocumentHandleInternal,
  type DocumentHandleWorkbookConfig,
} from './document-factory';

export { MogDocumentFactory } from './mog-document-factory';
export { createMogDocument, type MogDocument } from './mog-document-impl';
export { MogSdkEventFacade } from './mog-sdk-event-facade';
