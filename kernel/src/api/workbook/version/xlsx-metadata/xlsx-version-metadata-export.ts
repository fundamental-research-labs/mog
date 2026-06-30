import type { WorkbookVersion, WorkbookXlsxExportOptions } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { readCurrentHeadLocalObjectStoreAuthority } from './version-xlsx-metadata-export-authority';
import {
  authorizeMetadataSinkWrite,
  createMogWorkbookVersionXlsxMetadata,
  createMogVersionMetadataExportBlockedError,
  classifyVersionHeadFailureForMetadataExport,
  type MogVersionMetadataExportSink,
  type MogVersionMetadataExportSinkAuthorization,
  type MogVersionMetadataExportBlockReason,
} from './version-xlsx-metadata-export-gate';
import { addMogVersionMetadataToXlsx } from './xlsx-version-metadata-archive';
import { removeMogVersionMetadataPackageInventoryFromXlsx } from '../../xlsx-clean-export-package';

export async function maybeAddMogVersionMetadataToXlsx(
  ctx: DocumentContext,
  version: Pick<WorkbookVersion, 'getHead'>,
  xlsxBytes: Uint8Array,
  options: WorkbookXlsxExportOptions | undefined,
  sink: MogVersionMetadataExportSink = MOG_VERSION_METADATA_EXPORT_SINK,
): Promise<Uint8Array> {
  const xlsxWithoutImportedMogMetadata =
    await removeMogVersionMetadataPackageInventoryFromXlsx(xlsxBytes);
  if (options?.versionMetadata !== 'include') return xlsxWithoutImportedMogMetadata;
  const authorization = await maybeAuthorizeMogVersionMetadataExportSink(ctx, version);
  if (!authorization.ok) {
    if (
      authorization.reason === 'head-read-failed' ||
      authorization.reason === 'authority-unavailable'
    ) {
      return xlsxWithoutImportedMogMetadata;
    }
    throw createMogVersionMetadataExportBlockedError(authorization.reason);
  }
  return sink.write(xlsxWithoutImportedMogMetadata, authorization.value);
}

const MOG_VERSION_METADATA_EXPORT_SINK: MogVersionMetadataExportSink = {
  write: (xlsxBytes, authorization) =>
    addMogVersionMetadataToXlsx(xlsxBytes, authorization.metadata),
};

async function maybeAuthorizeMogVersionMetadataExportSink(
  ctx: DocumentContext,
  version: Pick<WorkbookVersion, 'getHead'>,
): Promise<
  | { readonly ok: true; readonly value: MogVersionMetadataExportSinkAuthorization }
  | { readonly ok: false; readonly reason: MogVersionMetadataExportBlockReason }
> {
  const head = await version.getHead();
  if (!head.ok) {
    return { ok: false, reason: classifyVersionHeadFailureForMetadataExport(head.error) };
  }
  const authority = await readCurrentHeadLocalObjectStoreAuthority(ctx, head);
  if (!authority.ok) {
    return { ok: false, reason: authority.reason };
  }
  const metadata = createMogWorkbookVersionXlsxMetadata(ctx, head, authority.value);
  const sinkAuthorization = authorizeMetadataSinkWrite(metadata, authority.value);
  if (!sinkAuthorization.ok) {
    return { ok: false, reason: sinkAuthorization.reason };
  }
  return sinkAuthorization;
}
