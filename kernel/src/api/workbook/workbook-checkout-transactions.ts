import type { DocumentContext } from '../../context';
import type { CheckoutSnapshotApplyInput } from '../../document/version-store/checkout-apply';
import type { CheckoutMaterializationDiagnostic } from '../../document/version-store/checkout-service';
import {
  checkoutDirtyWorkingStateDiagnostic,
  checkoutWriteFenceUnavailableDiagnostic,
  type VersionCheckoutTransactionBeginResult,
  type VersionCheckoutTransactionGuard,
  type VersionCheckoutTransactionToken,
} from './version-checkout';

type WorkbookCheckoutTransactionToken = VersionCheckoutTransactionToken & {
  readonly id: number;
  readonly mutationWatermark: number | null;
};

type CheckoutPublishDiagnosticCode =
  | 'VERSION_CHECKOUT_DIRTY_WORKING_STATE'
  | 'VERSION_CHECKOUT_WRITE_FENCE_STALE'
  | 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE';

export interface WorkbookCheckoutTransactionCoordinator {
  readonly checkoutInProgress: boolean;
  readonly guard: VersionCheckoutTransactionGuard;
  revalidateCheckoutPublish(
    input: CheckoutSnapshotApplyInput,
  ): readonly CheckoutMaterializationDiagnostic[];
}

export function createWorkbookCheckoutTransactionCoordinator(options: {
  readonly readContext: () => DocumentContext;
  readonly isDirty: () => boolean;
}): WorkbookCheckoutTransactionCoordinator {
  return new WorkbookCheckoutTransactionCoordinatorImpl(options);
}

class WorkbookCheckoutTransactionCoordinatorImpl implements WorkbookCheckoutTransactionCoordinator {
  private checkoutTransactionSequence = 0;
  private activeCheckoutTransaction: WorkbookCheckoutTransactionToken | null = null;

  readonly guard: VersionCheckoutTransactionGuard = {
    beginCheckoutTransaction: () => this.beginCheckoutTransaction(),
    endCheckoutTransaction: (token) => this.endCheckoutTransaction(token),
  };

  constructor(
    private readonly options: {
      readonly readContext: () => DocumentContext;
      readonly isDirty: () => boolean;
    },
  ) {}

  get checkoutInProgress(): boolean {
    return this.activeCheckoutTransaction !== null;
  }

  revalidateCheckoutPublish(
    input: CheckoutSnapshotApplyInput,
  ): readonly CheckoutMaterializationDiagnostic[] {
    const token = this.activeCheckoutTransaction;
    if (!token) {
      return [this.checkoutPublishDiagnostic(input, 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE')];
    }
    if (this.options.isDirty()) {
      return [this.checkoutPublishDiagnostic(input, 'VERSION_CHECKOUT_DIRTY_WORKING_STATE')];
    }

    const mutationWatermark = this.captureCheckoutMutationWatermark();
    if (mutationWatermark === false) {
      return [this.checkoutPublishDiagnostic(input, 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE')];
    }
    if (
      token.mutationWatermark !== null &&
      mutationWatermark !== null &&
      mutationWatermark !== token.mutationWatermark
    ) {
      return [this.checkoutPublishDiagnostic(input, 'VERSION_CHECKOUT_WRITE_FENCE_STALE')];
    }
    return [];
  }

  private beginCheckoutTransaction(): VersionCheckoutTransactionBeginResult {
    if (this.activeCheckoutTransaction) {
      return {
        ok: false,
        diagnostics: [
          checkoutWriteFenceUnavailableDiagnostic({ reason: 'checkoutAlreadyInProgress' }),
        ],
      };
    }
    if (this.options.isDirty()) {
      return { ok: false, diagnostics: [checkoutDirtyWorkingStateDiagnostic()] };
    }

    const mutationWatermark = this.captureCheckoutMutationWatermark();
    if (mutationWatermark === false) {
      return {
        ok: false,
        diagnostics: [checkoutWriteFenceUnavailableDiagnostic({ reason: 'writeGateRejected' })],
      };
    }

    const token = {
      id: ++this.checkoutTransactionSequence,
      mutationWatermark,
    } satisfies WorkbookCheckoutTransactionToken;
    this.activeCheckoutTransaction = token;
    return { ok: true, token };
  }

  private endCheckoutTransaction(token: VersionCheckoutTransactionToken): void {
    if (this.activeCheckoutTransaction === token) {
      this.activeCheckoutTransaction = null;
    }
  }

  private captureCheckoutMutationWatermark(): number | null | false {
    const ctx = this.options.readContext();
    try {
      ctx.writeGate.assertWritable('workbook.version.checkout');
    } catch {
      return false;
    }
    const snapshot = ctx.writeGate.captureHighWaterMark?.();
    return typeof snapshot?.mutationWatermark === 'number' ? snapshot.mutationWatermark : null;
  }

  private checkoutPublishDiagnostic(
    input: CheckoutSnapshotApplyInput,
    code: CheckoutPublishDiagnosticCode,
  ): CheckoutMaterializationDiagnostic {
    return {
      code,
      severity: 'error',
      message: checkoutPublishDiagnosticMessage(code),
      commitId: input.commitId,
      details: { cause: code },
    };
  }
}

function checkoutPublishDiagnosticMessage(code: CheckoutPublishDiagnosticCode): string {
  switch (code) {
    case 'VERSION_CHECKOUT_DIRTY_WORKING_STATE':
      return 'Checkout requires a clean workbook before publishing materialized state.';
    case 'VERSION_CHECKOUT_WRITE_FENCE_STALE':
      return 'Workbook state changed while checkout materialization was in progress.';
    case 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE':
      return 'Checkout could not acquire a local write fence before publishing materialized state.';
  }
}
