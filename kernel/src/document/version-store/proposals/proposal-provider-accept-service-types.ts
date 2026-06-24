import type {
  AcceptAgentProposalInput,
  VersionResult,
  WorkbookCommitId,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import type { ProposalGraphProvider, ResolvedBranchHead } from './proposal-provider-service-types';
import type { AgentProposalMetadataStore } from './proposal-store';
import type { WorkbookVersionMarkReviewAppliedInput } from '../review-service';

export type { ProposalGraphProvider };

export type AcceptProviderBackedAgentProposalOptions = {
  readonly input: AcceptAgentProposalInput;
  readonly openStore: () => Promise<AgentProposalMetadataStore>;
  readonly graphProvider?: ProposalGraphProvider;
  readonly ensureCommitExists: (commitId: WorkbookCommitId) => Promise<CommitExistsResult>;
  readonly resolveTargetHead: (targetRef: string) => Promise<ResolutionResult>;
  readonly getReview?: (reviewId: string) => Promise<VersionResult<WorkbookVersionReviewRecord>>;
  readonly markReviewApplied?: (
    input: WorkbookVersionMarkReviewAppliedInput,
  ) => Promise<VersionResult<WorkbookVersionReviewRecord>>;
};

export type ResolutionResult =
  | { readonly ok: true; readonly head: ResolvedBranchHead }
  | { readonly ok: false; readonly result: VersionResult<never> };

export type CommitExistsResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<never> };

export type FastForwardTargetResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly stale?: boolean;
      readonly actualTargetHeadId?: WorkbookCommitId;
      readonly result: VersionResult<never>;
    };
