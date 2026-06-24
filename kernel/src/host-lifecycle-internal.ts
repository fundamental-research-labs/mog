import { DocumentLifecycleSystem } from './document/document-lifecycle-system';
import { _createDocumentHandleInternal } from './api/document/document-factory';
import {
  documentImportWarningsFromDiagnostics,
  projectImportDiagnostic,
} from './api/document/import-diagnostics';
import { INTERNAL_INTERACTIVE_DEFERRED_IMPORT } from './api/document/xlsx-document-import';
import { xlsxImportRootSource } from './api/document/xlsx-document-import-provenance';
import { xlsxVersionMetadataTrust } from './api/document/xlsx-document-import-version-metadata';
import { validateAndResolveImportSource } from './document/host-import-source';
import {
  attachHostBootstrapCollaborationSidecar,
  fetchRoomSnapshotForHostBootstrap,
} from './document/collab/ws-sidecar';

export {
  DocumentLifecycleSystem,
  _createDocumentHandleInternal,
  attachHostBootstrapCollaborationSidecar,
  documentImportWarningsFromDiagnostics,
  fetchRoomSnapshotForHostBootstrap,
  INTERNAL_INTERACTIVE_DEFERRED_IMPORT,
  projectImportDiagnostic,
  validateAndResolveImportSource,
  xlsxImportRootSource,
  xlsxVersionMetadataTrust,
};
export { mapDocumentImportWarningToMogImportWarning } from './api/document/import-diagnostics';
export type { InteractiveDeferredImportToken } from './api/document/xlsx-document-import';
export type { DocumentHandle } from './api/document/document-factory';
export type { DocumentByteSyncPort } from './document/providers/provider';
export type {
  AuthorizedRoomBootstrap,
  HostAuthorizedRoomCreateOptions,
} from './document/document-lifecycle-system';
export type {
  FlushableWsSidecar as FlushableCollaborationSidecar,
  RoomSnapshot as HostRoomSnapshot,
  WsSidecarOptions as HostBootstrapCollaborationSidecarConfig,
} from './document/collab/ws-sidecar';
