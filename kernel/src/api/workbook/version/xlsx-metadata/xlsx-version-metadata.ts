export { createMogWorkbookVersionXlsxMetadata } from './version-xlsx-metadata-export-gate';
export {
  addMogVersionMetadataToXlsx,
  readAndValidateMogVersionMetadataFromXlsx,
  removeMogVersionMetadataFromXlsx,
} from './xlsx-version-metadata-archive';
export { maybeAddMogVersionMetadataToXlsx } from './xlsx-version-metadata-export';
export {
  MOG_VERSION_METADATA_PART,
  type MogWorkbookVersionXlsxMetadata,
  type MogWorkbookVersionXlsxMetadataExpectedHead,
} from './xlsx-version-metadata-schema';
export {
  validateMogWorkbookVersionXlsxMetadata,
  type MogWorkbookVersionXlsxMetadataTrustContext,
  type MogWorkbookVersionXlsxMetadataTrustReason,
  type MogWorkbookVersionXlsxMetadataTrustResult,
  type MogWorkbookVersionXlsxMetadataTrustSummary,
} from './xlsx-version-metadata-trust';
