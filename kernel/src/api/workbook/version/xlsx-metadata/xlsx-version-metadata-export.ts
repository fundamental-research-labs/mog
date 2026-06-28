import type { WorkbookVersion, WorkbookXlsxExportOptions } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { readCurrentHeadLocalObjectStoreAuthority } from './version-xlsx-metadata-export-authority';
import {
  authorizeMetadataSinkWrite,
  createMogWorkbookVersionXlsxMetadata,
  createMogVersionMetadataExportBlockedError,
  hasVersionHeadFailureDiagnostics,
  type MogVersionMetadataExportSink,
  type MogVersionMetadataExportSinkAuthorization,
} from './version-xlsx-metadata-export-gate';
import {
  addMogVersionMetadataToXlsx,
  removeMogVersionMetadataFromXlsx,
} from './xlsx-version-metadata-archive';

export async function maybeAddMogVersionMetadataToXlsx(
  ctx: DocumentContext,
  version: Pick<WorkbookVersion, 'getHead'>,
  xlsxBytes: Uint8Array,
  options: WorkbookXlsxExportOptions | undefined,
  sink: MogVersionMetadataExportSink = MOG_VERSION_METADATA_EXPORT_SINK,
): Promise<Uint8Array> {
  if (options?.versionMetadata !== 'include') return removeMogVersionMetadataFromXlsx(xlsxBytes);
  const authorization = await authorizeMogVersionMetadataExportSink(ctx, version);
  return sink.write(xlsxBytes, authorization);
}

const MOG_VERSION_METADATA_EXPORT_SINK: MogVersionMetadataExportSink = {
  write: (xlsxBytes, authorization) =>
    addMogVersionMetadataToXlsx(xlsxBytes, authorization.metadata),
};

async function authorizeMogVersionMetadataExportSink(
  ctx: DocumentContext,
  version: Pick<WorkbookVersion, 'getHead'>,
): Promise<MogVersionMetadataExportSinkAuthorization> {
  const head = await version.getHead();
  if (!head.ok) {
    const reason = hasVersionHeadFailureDiagnostics(head.error)
      ? 'redaction-failed'
      : 'head-read-failed';
    throw createMogVersionMetadataExportBlockedError(reason);
  }
  const authority = await readCurrentHeadLocalObjectStoreAuthority(ctx, head);
  if (!authority.ok) {
    throw createMogVersionMetadataExportBlockedError(authority.reason);
  }
  const metadata = createMogWorkbookVersionXlsxMetadata(ctx, head, authority.value);
  const sinkAuthorization = authorizeMetadataSinkWrite(metadata, authority.value);
  if (!sinkAuthorization.ok) {
    throw createMogVersionMetadataExportBlockedError(sinkAuthorization.reason);
  }
  return sinkAuthorization.value;
}
