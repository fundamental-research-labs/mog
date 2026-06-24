import type { WorkbookCommit } from './commit-store';
import type { VersionGraphReadHeadResult } from './graph';
import type { VersionObjectRecord } from './object-store';
import type {
  PendingRemotePromotionDiagnostic,
  PendingRemotePromotionSkipReason,
} from './pending-remote-promotion-diagnostics';

export type PendingRemotePromotionReadRequiredObjectResult =
  | {
      readonly status: 'success';
      readonly record: VersionObjectRecord<unknown>;
    }
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

export type PendingRemotePromotionBatchStatusDecision =
  | { readonly status: 'ok'; readonly diagnostics: readonly PendingRemotePromotionDiagnostic[] }
  | {
      readonly status: 'blocked';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

export type PendingRemotePromotionCurrentHeadReadResult =
  | Extract<VersionGraphReadHeadResult, { status: 'success' }>
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

export type PendingRemotePromotionVisibleClosureReadResult =
  | { readonly status: 'success'; readonly commits: readonly WorkbookCommit[] }
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };
