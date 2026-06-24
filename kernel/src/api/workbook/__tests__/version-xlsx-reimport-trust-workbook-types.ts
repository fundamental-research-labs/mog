import type { WorkbookCommitId } from '@mog-sdk/contracts/api';
import type { MogWorkbookVersionXlsxMetadata } from '../version/xlsx-metadata/xlsx-version-metadata';

export type TrustedExportSeed = {
  readonly rootCommitId: WorkbookCommitId;
  readonly exported: Uint8Array;
  readonly metadata: MogWorkbookVersionXlsxMetadata;
};
