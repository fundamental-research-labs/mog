import type { Workbook } from '@mog-sdk/contracts/api';

import type {
  VersionGraphInitializeResult,
  VersionStoreProvider,
} from '../../../document/version-store/provider';

export type PublicCellEditDiffWorkbook = Workbook;
export type PublicCellEditDiffProvider = VersionStoreProvider;
export type PublicCellEditDiffInitializedGraph = Extract<
  VersionGraphInitializeResult,
  { status: 'success' }
>;
export type PublicCellEditDiffCommit = Extract<
  Awaited<ReturnType<Workbook['version']['commit']>>,
  { ok: true }
>['value'];
export type PublicCellEditDiffHead = Extract<
  Awaited<ReturnType<Workbook['version']['getHead']>>,
  { ok: true }
>['value'];
export type PublicCellEditDiffHeadWithRevision = PublicCellEditDiffHead & {
  readonly refRevision: NonNullable<PublicCellEditDiffHead['refRevision']>;
};

export type InitialPublicCellEditCommitEvidence = {
  readonly committed: PublicCellEditDiffCommit;
  readonly committedHead: PublicCellEditDiffHeadWithRevision;
};
