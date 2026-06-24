import type { DocumentContext } from '../../../../context';

import { liveCollaborationDirtyStatus } from './version-live-collaboration-status-dirty';
import { bindMethod, isRecord } from './version-live-collaboration-status-guards';
import {
  absentLiveCollaborationStatus,
  projectLiveCollaborationStatus,
  unknownLiveCollaborationStatus,
  withDefaultStatusRevision,
} from './version-live-collaboration-status-projection';
import type {
  MaybePromise,
  MaybeVersionRuntimeContext,
  VersionLiveCollaborationDirtyStatus,
  VersionLiveCollaborationStatus,
  VersionLiveCollaborationStatusReader,
  VersionLiveCollaborationStatusReaderInput,
} from './version-live-collaboration-status-types';

export function createVersionLiveCollaborationStatusReader(
  input: VersionLiveCollaborationStatusReaderInput,
): VersionLiveCollaborationStatusReader {
  return () => {
    const state = input.readState();
    const projected = projectLiveCollaborationStatus(withDefaultStatusRevision(state));
    return (
      projected ??
      unknownLiveCollaborationStatus(
        'The local VC-05 live-collaboration state reader returned an invalid payload.',
      )
    );
  };
}

export async function readVersionLiveCollaborationStatus(
  ctx: DocumentContext,
): Promise<VersionLiveCollaborationDirtyStatus> {
  const reader = getAttachedLiveCollaborationStatusReader(ctx);
  if (!reader) return liveCollaborationDirtyStatus(absentLiveCollaborationStatus());

  try {
    const projected = projectLiveCollaborationStatus(await reader());
    if (projected) return liveCollaborationDirtyStatus(projected);
  } catch {
    return liveCollaborationDirtyStatus(
      unknownLiveCollaborationStatus(
        'The attached VC-05 live-collaboration status service failed.',
      ),
    );
  }

  return liveCollaborationDirtyStatus(
    unknownLiveCollaborationStatus(
      'The attached VC-05 live-collaboration status service returned an invalid payload.',
    ),
  );
}

function getAttachedLiveCollaborationStatusReader(
  ctx: DocumentContext,
): VersionLiveCollaborationStatusReader | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.liveCollaborationStatusService,
    services.versionLiveCollaborationStatusService,
    services.collaborationStatusService,
    services.versionCollaborationStatusService,
    services,
  ]) {
    const reader = toLiveCollaborationStatusReader(candidate);
    if (reader) return reader;
  }
  return null;
}

function toLiveCollaborationStatusReader(
  value: unknown,
): VersionLiveCollaborationStatusReader | null {
  const read =
    bindMethod(value, 'readLiveCollaborationStatus') ??
    bindMethod(value, 'getLiveCollaborationStatus') ??
    bindMethod(value, 'readStatus') ??
    bindMethod(value, 'getStatus');
  return read ? () => read() as MaybePromise<VersionLiveCollaborationStatus> : null;
}
