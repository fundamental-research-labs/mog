import type {
  CollaborationSidecar,
  CollaborationSidecarStatus,
  DocumentHandle,
  DocumentHandleWorkbookConfig,
  VersionLiveCollaborationStatusReader,
} from '@mog-sdk/kernel';

type MutableDocumentHandleWorkbook = {
  workbook(config?: DocumentHandleWorkbookConfig): ReturnType<DocumentHandle['workbook']>;
};

export function decorateCollaborationHandleWithVersioning(
  handle: DocumentHandle,
  sidecar: CollaborationSidecar,
  roomId: string,
): DocumentHandle {
  const originalWorkbook = handle.workbook.bind(handle);
  const readLiveCollaborationStatus = createLiveCollaborationStatusReader(sidecar, roomId);
  (handle as DocumentHandle & MutableDocumentHandleWorkbook).workbook = ((
    config?: DocumentHandleWorkbookConfig,
  ) =>
    originalWorkbook({
      ...config,
      versioning: {
        ...config?.versioning,
        readLiveCollaborationStatus,
      },
    })) as DocumentHandle['workbook'];
  return handle;
}

function createLiveCollaborationStatusReader(
  sidecar: CollaborationSidecar,
  roomId: string,
): VersionLiveCollaborationStatusReader {
  return () => {
    const sidecarStatus = sidecar.status;
    const activeParticipantCount = sidecar.participants.size;
    if (!isCollaborationSidecarStatus(sidecarStatus)) {
      return {
        state: 'unknown',
        statusRevision: `shellCollaboration|room:${roomId}|sidecar:unknown`,
        roomId,
      };
    }
    return {
      state: 'active',
      statusRevision: [
        'shellCollaboration',
        `room:${roomId}`,
        `sidecar:${sidecarStatus}`,
        `participants:${activeParticipantCount}`,
      ].join('|'),
      roomId,
      sidecarStatus,
      activeParticipantCount,
    };
  };
}

function isCollaborationSidecarStatus(value: unknown): value is CollaborationSidecarStatus {
  return (
    value === 'connecting' || value === 'online' || value === 'reconnecting' || value === 'offline'
  );
}
