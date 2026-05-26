import { DocumentLifecycleSystem } from './document/document-lifecycle-system';
import { _createDocumentHandleInternal } from './api/document/document-factory';
import { validateAndResolveImportSource } from './document/host-import-source';
import {
  attachHostBootstrapCollaborationSidecar,
  fetchRoomSnapshotForHostBootstrap,
} from './document/collab/ws-sidecar';

export {
  DocumentLifecycleSystem,
  _createDocumentHandleInternal,
  attachHostBootstrapCollaborationSidecar,
  fetchRoomSnapshotForHostBootstrap,
  validateAndResolveImportSource,
};
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
