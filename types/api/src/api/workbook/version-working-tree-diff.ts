import type {
  ObjectDigest,
  VersionDiffOptions,
  VersionMainRefName,
  VersionRefName,
  VersionSemanticDiffPage,
  WorkbookCommitId,
} from './version';

export type VersionWorkingTreeDiffId = string & {
  readonly __brand?: 'VersionWorkingTreeDiffId';
};

export interface VersionWorkingTreeDiffOptions extends VersionDiffOptions {
  readonly base?: 'activeCheckoutHead';
}

export interface VersionWorkingTreeDiffPage extends VersionSemanticDiffPage {
  readonly kind: 'workingTree';
  readonly workingTreeDiffId: VersionWorkingTreeDiffId;
  readonly baseCommitId: WorkbookCommitId;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly captureRevision: number;
  readonly dirtyStatusRevision: string;
  readonly checkoutPreflightToken: string;
  readonly baseSemanticStateDigest: ObjectDigest;
  readonly currentSemanticStateDigest: ObjectDigest;
}
