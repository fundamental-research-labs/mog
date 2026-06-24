import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { MogWorkbookVersionXlsxMetadataTrustReason } from '../version/xlsx-metadata/xlsx-version-metadata';
import type { TrustedExportSeed } from './version-xlsx-reimport-trust-workbook';

export type UntrustedMetadataCase = {
  readonly name: string;
  readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
  readonly xlsx: (seed: TrustedExportSeed) => Promise<Uint8Array>;
};

export type UntrustedNewRootReimportScenario = {
  readonly xlsxBytes: Uint8Array;
  readonly expectedHeadCommitId: WorkbookCommitId;
  readonly reason: MogWorkbookVersionXlsxMetadataTrustReason;
  readonly expectedA1Value?: string;
  readonly unexpectedCommitIds?: readonly WorkbookCommitId[];
};
