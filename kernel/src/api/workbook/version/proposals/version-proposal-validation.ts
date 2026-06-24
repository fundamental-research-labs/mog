export type { ValidationResult } from './version-proposal-validation-types';

export {
  normalizeCreateProposalInput,
  normalizeFailProposalInput,
  normalizeGetProposalInput,
  normalizeListProposalsInput,
} from './version-proposal-validation-proposal';
export {
  normalizeCommitProposalWorkspaceInput,
  normalizeDisposeProposalWorkspaceInput,
  normalizeGetProposalWorkspaceInput,
  normalizeStartProposalWorkspaceInput,
} from './version-proposal-validation-workspace';
export {
  normalizeMarkProposalVerifiedInput,
  normalizeOpenProposalReviewInput,
} from './version-proposal-validation-review';
export {
  normalizeAcceptProposalInput,
  normalizeRejectProposalInput,
  normalizeSupersedeProposalInput,
} from './version-proposal-validation-resolution';
