import type { DocumentContext } from '../../context';
import type { CheckoutSnapshotApplyInput } from '../../document/version-store/checkout-apply';
import type { CheckoutMaterializationDiagnostic } from '../../document/version-store/checkout-service';
import type { SnapshotRootFreshLifecycleMaterialization } from '../document/snapshot-root-lifecycle-hydrator';
import type { WorkbookVersioningConfig } from './types';
import { createWorkbookCheckoutSnapshotMaterializer } from './version/checkout/version-checkout-materializer';

export function withDefaultWorkbookCheckoutMaterializer(
  versioning: WorkbookVersioningConfig | undefined,
  deps: {
    readonly currentContext: () => DocumentContext;
    readonly revalidateCheckoutPublish: (
      input: CheckoutSnapshotApplyInput,
    ) => readonly CheckoutMaterializationDiagnostic[];
    readonly publishCheckoutMaterialization: (
      materialization: SnapshotRootFreshLifecycleMaterialization,
      input: CheckoutSnapshotApplyInput,
    ) => Promise<void>;
  },
): WorkbookVersioningConfig | undefined {
  if (
    !versioning ||
    versioning.checkoutSnapshotMaterializer ||
    !versioning.snapshotRootByteSyncPort
  ) {
    return versioning;
  }

  return {
    ...versioning,
    checkoutSnapshotMaterializer: createWorkbookCheckoutSnapshotMaterializer(deps),
  };
}

export function withPreviouslySavedVersioningInitialization(
  versioning: WorkbookVersioningConfig | undefined,
  deps: {
    readonly previouslySaved: boolean;
    readonly currentContext: () => DocumentContext;
    readonly markClean: () => void;
  },
): WorkbookVersioningConfig | undefined {
  if (!deps.previouslySaved || !versioning?.ensureProviderInitialized) return versioning;
  const ensureProviderInitialized = versioning.ensureProviderInitialized;
  return {
    ...versioning,
    ensureProviderInitialized: async () => {
      const diagnostics = await ensureProviderInitialized();
      if (diagnostics.length === 0 && !hasPendingNormalVersionMutations(deps.currentContext())) {
        deps.markClean();
      }
      return diagnostics;
    },
  };
}

function hasPendingNormalVersionMutations(ctx: DocumentContext): boolean {
  const services = (ctx as DocumentContext & { versioning?: unknown }).versioning;
  if (!isRuntimeRecord(services)) return false;
  const semanticMutationCapture = services.semanticMutationCapture;
  if (!isRuntimeRecord(semanticMutationCapture)) return false;
  const readState = semanticMutationCapture.readNormalCommitCaptureState;
  if (typeof readState !== 'function') return false;

  try {
    const state = Reflect.apply(readState, semanticMutationCapture, []) as unknown;
    if (!isRuntimeRecord(state)) return false;
    return (
      state.hasPendingNormalMutations === true ||
      toFiniteCount(state.pendingCapturedNormalMutationCount) > 0 ||
      toFiniteCount(state.pendingUncapturedNormalMutationCount) > 0
    );
  } catch {
    return true;
  }
}

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toFiniteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
