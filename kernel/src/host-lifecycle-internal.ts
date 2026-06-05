import { DocumentLifecycleSystem } from './document/document-lifecycle-system';
import { _createDocumentHandleInternal } from './api/document/document-factory';
import {
  documentImportWarningsFromDiagnostics,
  projectImportDiagnostic,
} from './api/document/import-diagnostics';
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
  projectImportDiagnostic,
  validateAndResolveImportSource,
};
export { mapDocumentImportWarningToMogImportWarning } from './api/document/import-diagnostics';
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
