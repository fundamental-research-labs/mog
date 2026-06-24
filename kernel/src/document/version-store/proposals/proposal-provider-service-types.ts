import type { VersionMainRefName, VersionRefName, WorkbookCommitId } from '@mog-sdk/contracts/api';
import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import type { CreateBranchResult, ReadBranchResult } from '../branch-service';
import type { VersionStoreProvider } from '../provider';
import type { RefVersion } from '../refs/ref-store';

export type MaybePromise<T> = T | Promise<T>;

export type ProposalProviderOperation =
  | 'acceptProposal'
  | 'commitProposalWorkspace'
  | 'createProposal'
  | 'disposeProposalWorkspace'
  | 'failProposal'
  | 'getProposal'
  | 'getProposalWorkspace'
  | 'listProposals'
  | 'markProposalVerified'
  | 'openProposalReview'
  | 'rejectProposal'
  | 'startProposalWorkspace'
  | 'supersedeProposal';

export type ProposalBranchService = {
  readBranch(
    input: { readonly name: string } | string,
  ): Promise<ReadBranchResult> | ReadBranchResult;
  createBranch(input: {
    readonly name: string;
    readonly targetCommitId: WorkbookCommitId | string;
    readonly expectedAbsent: true;
    readonly baseCommitId?: WorkbookCommitId | string;
    readonly createdBy: GraphVersionAuthor;
    readonly protected?: boolean;
  }): Promise<CreateBranchResult> | CreateBranchResult;
};

export type ProposalGraphProvider = Pick<
  VersionStoreProvider,
  'accessContext' | 'openGraph' | 'readGraphRegistry'
>;

export type ResolvedBranchHead = {
  readonly branchName: string;
  readonly refName: VersionMainRefName | VersionRefName;
  readonly commitId: WorkbookCommitId;
  readonly refVersion: RefVersion;
};

export const PROPOSAL_BRANCH_AUTHOR: GraphVersionAuthor = Object.freeze({
  authorId: 'version-proposal-service',
  actorKind: 'system',
  displayName: 'Version Proposal Service',
});
