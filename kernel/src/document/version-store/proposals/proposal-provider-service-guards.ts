import type {
  ProposalBranchService,
  ProposalGraphProvider,
} from './proposal-provider-service-types';
import type { WorkbookVersionReviewService } from '../review-service';

export function isProposalBranchService(value: unknown): value is ProposalBranchService {
  return (
    isRecord(value) &&
    typeof value.readBranch === 'function' &&
    typeof value.createBranch === 'function'
  );
}

export function isProposalGraphProvider(value: unknown): value is ProposalGraphProvider {
  return (
    isRecord(value) &&
    typeof value.readGraphRegistry === 'function' &&
    typeof value.openGraph === 'function' &&
    isRecord(value.accessContext)
  );
}

export function isWorkbookVersionReviewService(
  value: unknown,
): value is WorkbookVersionReviewService {
  return (
    isRecord(value) &&
    typeof value.createReview === 'function' &&
    typeof value.getReview === 'function'
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
