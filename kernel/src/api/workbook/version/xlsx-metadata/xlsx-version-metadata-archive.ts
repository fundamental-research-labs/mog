import {
  parseMogWorkbookVersionXlsxMetadata,
  type MogWorkbookVersionXlsxMetadata,
} from './xlsx-version-metadata-schema';
import {
  absentMogVersionMetadataResult,
  hasRequiredVersionMetadataImportRedaction,
  trustedMogVersionMetadataResult,
  trustedStaleBaseMogVersionMetadataResult,
  untrustedMogVersionMetadataResult,
  validateMogWorkbookVersionXlsxMetadata,
  type MogWorkbookVersionXlsxMetadataTrustContext,
  type MogWorkbookVersionXlsxMetadataTrustResult,
} from './xlsx-version-metadata-trust';
import { parseMogVersionMetadataJsonPayload } from './xlsx-version-metadata-xml';
import {
  readMogVersionMetadataXmlFromXlsx,
  rewriteMogVersionMetadataInXlsx,
} from './xlsx-version-metadata-zip';

export function addMogVersionMetadataToXlsx(
  xlsxBytes: Uint8Array,
  metadata: MogWorkbookVersionXlsxMetadata,
): Uint8Array {
  return rewriteMogVersionMetadataInXlsx(xlsxBytes, metadata);
}

export function removeMogVersionMetadataFromXlsx(xlsxBytes: Uint8Array): Uint8Array {
  return rewriteMogVersionMetadataInXlsx(xlsxBytes, null);
}

export function readAndValidateMogVersionMetadataFromXlsx(
  xlsxBytes: Uint8Array,
  context: MogWorkbookVersionXlsxMetadataTrustContext,
): MogWorkbookVersionXlsxMetadataTrustResult {
  try {
    const metadataRead = readMogVersionMetadataXmlFromXlsx(xlsxBytes);
    if (metadataRead.status === 'absent') {
      return absentMogVersionMetadataResult();
    }
    if (metadataRead.status === 'untrusted') {
      return untrustedMogVersionMetadataResult(metadataRead.reason);
    }

    let parsed: unknown;
    try {
      parsed = parseMogVersionMetadataJsonPayload(metadataRead.xml);
    } catch {
      return untrustedMogVersionMetadataResult('malformed-sidecar');
    }

    const metadata = parseMogWorkbookVersionXlsxMetadata(parsed);
    if (!metadata) return untrustedMogVersionMetadataResult('invalid-schema');
    if (!hasRequiredVersionMetadataImportRedaction(metadata)) {
      return untrustedMogVersionMetadataResult('invalid-schema');
    }

    const validation = validateMogWorkbookVersionXlsxMetadata(metadata, context);
    if (validation.status === 'trusted') {
      return trustedMogVersionMetadataResult(metadata);
    }
    if (validation.status === 'trusted-stale-base') {
      return trustedStaleBaseMogVersionMetadataResult(metadata);
    }

    return untrustedMogVersionMetadataResult(
      validation.reason,
      validation.reason === 'head-unverified' ? metadata : undefined,
    );
  } catch {
    return untrustedMogVersionMetadataResult('malformed-sidecar');
  }
}
