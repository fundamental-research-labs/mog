import type { DocumentContext } from '../../context';
import type { CheckoutSnapshotApplyInput } from '../../document/version-store/checkout-apply';
import type { CheckoutMaterializationDiagnostic } from '../../document/version-store/checkout-service';
import {
  checkoutWriteFenceUnavailableDiagnostic,
  type VersionCheckoutTransactionBeginResult,
  type VersionCheckoutTransactionGuard,
  type VersionCheckoutTransactionToken,
} from './version-checkout';

type WorkbookCheckoutTransactionToken = VersionCheckoutTransactionToken & {
  readonly id: number;
  readonly mutationWatermark: number | null;
  readonly dirtyRevision: number;
};

type CheckoutPublishDiagnosticCode =
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
  readonly readDirtyState: () => { readonly revision: number };
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
      readonly readDirtyState: () => { readonly revision: number };
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
    if (this.options.readDirtyState().revision !== token.dirtyRevision) {
      return [this.checkoutPublishDiagnostic(input, 'VERSION_CHECKOUT_WRITE_FENCE_STALE')];
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
    const dirtyRevision = this.options.readDirtyState().revision;

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
      dirtyRevision,
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
    case 'VERSION_CHECKOUT_WRITE_FENCE_STALE':
      return 'Workbook state changed while checkout materialization was in progress.';
    case 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE':
      return 'Checkout could not acquire a local write fence before publishing materialized state.';
  }
}
