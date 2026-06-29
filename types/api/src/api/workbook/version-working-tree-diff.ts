import type {
  ObjectDigest,
  VersionDiffOptions,
  VersionMainRefName,
  VersionRefName,
  VersionSemanticDiffPage,
  WorkbookCommitId,
} from './version';
import type { VersionDiffOverview, VersionDiffOverviewOptions } from './version-diff';

export type VersionWorkingTreeDiffId = string & {
  readonly __brand?: 'VersionWorkingTreeDiffId';
};

export type VersionWorkingTreeDiffOverviewOptions = VersionDiffOverviewOptions;

export interface VersionWorkingTreeDiffOverview
  extends Omit<VersionDiffOverview, 'targetCommitId'> {
  readonly kind: 'workingTree';
  readonly workingTreeDiffId: VersionWorkingTreeDiffId;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly captureRevision: number;
  readonly dirtyStatusRevision: string;
  readonly checkoutPreflightToken: string;
  readonly baseSemanticStateDigest: ObjectDigest;
  readonly currentSemanticStateDigest: ObjectDigest;
}

export interface VersionWorkingTreeDiffOptions extends VersionDiffOptions {
  readonly base?: 'activeCheckoutHead';
  readonly includeOverview?: boolean;
  readonly overview?: VersionWorkingTreeDiffOverviewOptions;
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
  readonly overview?: VersionWorkingTreeDiffOverview;
}
