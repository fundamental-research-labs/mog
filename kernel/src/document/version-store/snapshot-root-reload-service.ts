import {
  createSnapshotRootReloadHydrationInput,
  createSnapshotRootReloadHydratorFailedResult,
  createSnapshotRootReloadHydratorRejectedResult,
  createSnapshotRootReloadMaterializedResult,
  invalidHydratorResult,
  isPlainRecord,
  planSnapshotRootReload,
  verifySnapshotRootReloadSemanticIdentity,
} from './snapshot-root-reload-plan';
import type {
  SnapshotRootFreshLifecycleHydrationResult,
  SnapshotRootFreshLifecycleHydrator,
  SnapshotRootReloadInvariants,
  SnapshotRootReloadResult,
  SnapshotRootReloadServiceOptions,
} from './snapshot-root-reload-types';

export type {
  SnapshotRootCurrentWorkbookMutationGuarantee,
  SnapshotRootFreshLifecycleHydrationInput,
  SnapshotRootFreshLifecycleHydrationResult,
  SnapshotRootFreshLifecycleHydrator,
  SnapshotRootFreshLifecycleMutationGuarantee,
  SnapshotRootReloadCommitRootProof,
  SnapshotRootReloadDiagnostic,
  SnapshotRootReloadDiagnosticCode,
  SnapshotRootReloadError,
  SnapshotRootReloadErrorCode,
  SnapshotRootReloadInput,
  SnapshotRootReloadInvariants,
  SnapshotRootReloadResult,
  SnapshotRootReloadServiceOptions,
  SnapshotRootReloadSourceKind,
  SnapshotRootSemanticIdentityProof,
  SnapshotRootSemanticIdentityVerificationInput,
  SnapshotRootSemanticIdentityVerificationResult,
  SnapshotRootSemanticIdentityVerifier,
} from './snapshot-root-reload-types';

export class SnapshotRootReloadService<TMaterialized = unknown> {
  private readonly hydrator: SnapshotRootFreshLifecycleHydrator<TMaterialized>;
  private readonly invariants: SnapshotRootReloadInvariants<TMaterialized>;

  constructor(options: SnapshotRootReloadServiceOptions<TMaterialized>) {
    this.hydrator = options.hydrator;
    this.invariants = options.invariants ?? {};
  }

  async reloadSnapshotRoot(
    snapshotRoot: unknown,
    invariants: SnapshotRootReloadInvariants<TMaterialized> = {},
  ): Promise<SnapshotRootReloadResult<TMaterialized>> {
    const planned = planSnapshotRootReload(snapshotRoot, this.invariants, invariants);
    if (!planned.ok) return planned.result;

    const { plan } = planned;
    let hydration: SnapshotRootFreshLifecycleHydrationResult<TMaterialized>;
    try {
      hydration = await this.hydrator.hydrateYrsFullState(
        createSnapshotRootReloadHydrationInput(plan),
      );
    } catch (error) {
      return createSnapshotRootReloadHydratorFailedResult(error, plan.decoded.byteLength);
    }

    if (!isPlainRecord(hydration)) {
      return invalidHydratorResult(plan.decoded.byteLength);
    }

    if (hydration.status === 'materialized') {
      const semanticIdentity = await verifySnapshotRootReloadSemanticIdentity(plan, hydration);
      if (!semanticIdentity.ok) return semanticIdentity.result;
      return createSnapshotRootReloadMaterializedResult(plan, hydration, semanticIdentity);
    }

    if (hydration.status === 'failed') {
      return createSnapshotRootReloadHydratorRejectedResult(hydration, plan.decoded.byteLength);
    }

    return invalidHydratorResult(plan.decoded.byteLength);
  }
}

export function createSnapshotRootReloadService<TMaterialized = unknown>(
  options: SnapshotRootReloadServiceOptions<TMaterialized>,
): SnapshotRootReloadService<TMaterialized> {
  return new SnapshotRootReloadService(options);
}
