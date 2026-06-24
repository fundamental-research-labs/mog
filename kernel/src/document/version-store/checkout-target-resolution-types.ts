import type { WorkbookCommitId } from './object-digest';
import type { RefName } from './refs/ref-name';
import type {
  CheckoutHeadReader,
  CheckoutMaterializationDiagnostic,
  CheckoutMaterializationResult,
  CheckoutRefReader,
  CheckoutResolvedMaterializationTarget,
} from './checkout-service';

export type ParsedCheckoutRequest =
  | {
      readonly ok: true;
      readonly target: 'commit';
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly ok: true;
      readonly target: 'head';
    }
  | {
      readonly ok: true;
      readonly target: 'ref';
      readonly refName: RefName;
    }
  | {
      readonly ok: false;
      readonly result: CheckoutMaterializationResult;
    };

export type ResolvedTargetResult =
  | {
      readonly ok: true;
      readonly target: CheckoutResolvedMaterializationTarget;
      readonly commitId: WorkbookCommitId;
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly result: CheckoutMaterializationResult;
    };

export interface CheckoutTargetResolutionReaders {
  readonly headReader?: CheckoutHeadReader;
  readonly refReader?: CheckoutRefReader;
}
