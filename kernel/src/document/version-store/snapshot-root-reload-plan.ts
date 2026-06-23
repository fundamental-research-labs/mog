import type { ObjectDigest } from './object-digest';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from './object-store';
import {
  decodeYrsFullStateSnapshotRootPayload,
  validateWorkbookSnapshotRootRecord,
  validateYrsFullStateSnapshotRootPayload,
} from './snapshot-root-capture';
import {
  failure,
  freezeDiagnostics,
  invalidSnapshotRootDiagnostic,
  invariantFailure,
  missingCommitRootDiagnostic,
  wrongNamespaceDiagnostic,
} from './snapshot-root-reload-diagnostics';
import {
  cloneBytes,
  cloneDigest,
  cloneNamespace,
  digestsEqual,
  freezeCommitRoots,
  isPlainRecord,
  isValidCommitRoot,
  validateSemanticIdentityProof,
} from './snapshot-root-reload-identity-validation';
import type {
  SnapshotRootFreshLifecycleHydrationInput,
  SnapshotRootFreshLifecycleHydrationResult,
  SnapshotRootReloadDiagnostic,
  SnapshotRootReloadInvariants,
  SnapshotRootReloadResult,
  SnapshotRootReloadSourceKind,
  SnapshotRootSemanticIdentityProof,
} from './snapshot-root-reload-types';

export {
  createSnapshotRootReloadHydratorFailedResult,
  createSnapshotRootReloadHydratorRejectedResult,
  invalidHydratorResult,
} from './snapshot-root-reload-diagnostics';
export { isPlainRecord } from './snapshot-root-reload-identity-validation';

export type DecodedSnapshotRoot = {
  readonly source: SnapshotRootReloadSourceKind;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly objectDigest?: ObjectDigest;
  readonly namespace?: VersionGraphNamespace;
};

export interface SnapshotRootReloadPlan<TMaterialized = unknown> {
  readonly decoded: DecodedSnapshotRoot;
  readonly invariants: SnapshotRootReloadInvariants<TMaterialized>;
}

export type SnapshotRootReloadPlanResult<TMaterialized = unknown> =
  | {
      readonly ok: true;
      readonly plan: SnapshotRootReloadPlan<TMaterialized>;
    }
  | {
      readonly ok: false;
      readonly result: Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: false }>;
    };

export function planSnapshotRootReload<TMaterialized>(
  snapshotRoot: unknown,
  baseInvariants: SnapshotRootReloadInvariants<TMaterialized>,
  overrideInvariants: SnapshotRootReloadInvariants<TMaterialized>,
): SnapshotRootReloadPlanResult<TMaterialized> {
  let decoded: DecodedSnapshotRoot;
  try {
    decoded = decodeSnapshotRoot(snapshotRoot);
  } catch (error) {
    return {
      ok: false,
      result: failure(
        'invalidSnapshotRoot',
        'Snapshot root is not a materializable yrs full-state snapshot root.',
        [invalidSnapshotRootDiagnostic(error)],
        'not-started',
      ),
    };
  }

  const mergedInvariants = mergeInvariants(baseInvariants, overrideInvariants);
  const invariantDiagnostics = validatePreHydrationInvariants(decoded, mergedInvariants);
  if (invariantDiagnostics.length > 0) {
    return {
      ok: false,
      result: invariantFailure(invariantDiagnostics, decoded.byteLength),
    };
  }

  return {
    ok: true,
    plan: Object.freeze({
      decoded,
      invariants: mergedInvariants,
    }),
  };
}

export function createSnapshotRootReloadHydrationInput<TMaterialized>(
  plan: SnapshotRootReloadPlan<TMaterialized>,
): SnapshotRootFreshLifecycleHydrationInput {
  return createHydrationInput(plan.decoded, cloneBytes(plan.decoded.bytes), plan.invariants);
}

export async function verifySnapshotRootReloadSemanticIdentity<TMaterialized>(
  plan: SnapshotRootReloadPlan<TMaterialized>,
  hydration: Extract<
    SnapshotRootFreshLifecycleHydrationResult<TMaterialized>,
    { readonly status: 'materialized' }
  >,
): Promise<
  | {
      readonly ok: true;
      readonly proof?: SnapshotRootSemanticIdentityProof;
      readonly diagnostics: readonly SnapshotRootReloadDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly result: Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: false }>;
    }
> {
  return validateSemanticIdentityProof(plan.decoded, hydration, plan.invariants);
}

export function createSnapshotRootReloadMaterializedResult<TMaterialized>(
  plan: SnapshotRootReloadPlan<TMaterialized>,
  hydration: Extract<
    SnapshotRootFreshLifecycleHydrationResult<TMaterialized>,
    { readonly status: 'materialized' }
  >,
  semanticIdentity: {
    readonly proof?: SnapshotRootSemanticIdentityProof;
    readonly diagnostics: readonly SnapshotRootReloadDiagnostic[];
  },
): Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: true }> {
  return Object.freeze({
    ok: true,
    materialization: 'fresh-lifecycle',
    materialized: hydration.materialized,
    decodedByteLength: plan.decoded.byteLength,
    diagnostics: freezeDiagnostics([
      ...(hydration.diagnostics ?? []),
      ...semanticIdentity.diagnostics,
    ]),
    ...(semanticIdentity.proof === undefined
      ? {}
      : { semanticIdentityProof: semanticIdentity.proof }),
    mutationGuarantee: 'no-current-workbook-mutation',
    freshLifecycleMutationGuarantee: 'fresh-lifecycle-materialized',
  });
}

function decodeSnapshotRoot(snapshotRoot: unknown): DecodedSnapshotRoot {
  if (isVersionObjectRecordCandidate(snapshotRoot)) {
    const record = validateWorkbookSnapshotRootRecord(snapshotRoot as VersionObjectRecord<unknown>);
    const namespace = normalizeVersionGraphNamespace(record.namespace, 'record.namespace');
    const bytes = decodeYrsFullStateSnapshotRootPayload(record.preimage.payload);
    return Object.freeze({
      source: 'record',
      bytes,
      byteLength: bytes.byteLength,
      objectDigest: cloneDigest(record.digest),
      namespace,
    });
  }

  const payload = validateYrsFullStateSnapshotRootPayload(snapshotRoot);
  const bytes = decodeYrsFullStateSnapshotRootPayload(payload);
  return Object.freeze({
    source: 'payload',
    bytes,
    byteLength: bytes.byteLength,
  });
}

function createHydrationInput<TMaterialized>(
  decoded: DecodedSnapshotRoot,
  bytes: Uint8Array,
  invariants: SnapshotRootReloadInvariants<TMaterialized>,
): SnapshotRootFreshLifecycleHydrationInput {
  return Object.freeze({
    yrsFullStateBytes: bytes,
    byteLength: decoded.byteLength,
    source: decoded.source,
    ...(decoded.objectDigest === undefined
      ? {}
      : { objectDigest: cloneDigest(decoded.objectDigest) }),
    ...(decoded.namespace === undefined ? {} : { namespace: cloneNamespace(decoded.namespace) }),
    requiredCommitRoots: freezeCommitRoots(invariants.requiredCommitRoots ?? []),
  });
}

function mergeInvariants<TMaterialized>(
  base: SnapshotRootReloadInvariants<TMaterialized>,
  override: SnapshotRootReloadInvariants<TMaterialized>,
): SnapshotRootReloadInvariants<TMaterialized> {
  return {
    expectedNamespace: override.expectedNamespace ?? base.expectedNamespace,
    requiredCommitRoots: override.requiredCommitRoots ?? base.requiredCommitRoots,
    requireCommitRootProof: override.requireCommitRootProof ?? base.requireCommitRootProof,
    requireSemanticIdentityProof:
      override.requireSemanticIdentityProof ?? base.requireSemanticIdentityProof,
    semanticIdentityVerifier: override.semanticIdentityVerifier ?? base.semanticIdentityVerifier,
  };
}

function validatePreHydrationInvariants<TMaterialized>(
  decoded: DecodedSnapshotRoot,
  invariants: SnapshotRootReloadInvariants<TMaterialized>,
): readonly SnapshotRootReloadDiagnostic[] {
  const diagnostics: SnapshotRootReloadDiagnostic[] = [];
  const expectedNamespace = invariants.expectedNamespace;
  let normalizedExpectedNamespace: VersionGraphNamespace | undefined;

  if (expectedNamespace !== undefined) {
    normalizedExpectedNamespace = normalizeVersionGraphNamespace(
      expectedNamespace,
      'invariants.expectedNamespace',
    );
    if (decoded.namespace === undefined) {
      diagnostics.push(wrongNamespaceDiagnostic('snapshotRoot', normalizedExpectedNamespace));
    } else if (
      versionGraphNamespaceKey(decoded.namespace) !==
      versionGraphNamespaceKey(normalizedExpectedNamespace)
    ) {
      diagnostics.push(
        wrongNamespaceDiagnostic(
          'record.namespace',
          normalizedExpectedNamespace,
          decoded.namespace,
        ),
      );
    }
  }

  const requiresCommitRoots =
    invariants.requireCommitRootProof === true || invariants.requiredCommitRoots !== undefined;
  if (!requiresCommitRoots) return diagnostics;

  const roots = invariants.requiredCommitRoots ?? [];
  if (roots.length === 0) {
    diagnostics.push(missingCommitRootDiagnostic('invariants.requiredCommitRoots'));
    return diagnostics;
  }

  if (decoded.objectDigest === undefined) {
    diagnostics.push(missingCommitRootDiagnostic('snapshotRoot'));
    return diagnostics;
  }

  const matchingRoot = roots.find((root, index) => {
    if (!isValidCommitRoot(root)) return false;
    const normalizedRootNamespace = normalizeVersionGraphNamespace(
      root.namespace,
      `invariants.requiredCommitRoots[${index}].namespace`,
    );
    if (
      normalizedExpectedNamespace !== undefined &&
      versionGraphNamespaceKey(normalizedRootNamespace) !==
        versionGraphNamespaceKey(normalizedExpectedNamespace)
    ) {
      return false;
    }
    if (
      decoded.namespace !== undefined &&
      versionGraphNamespaceKey(normalizedRootNamespace) !==
        versionGraphNamespaceKey(decoded.namespace)
    ) {
      return false;
    }
    return (
      decoded.objectDigest !== undefined &&
      digestsEqual(root.snapshotRootDigest, decoded.objectDigest)
    );
  });

  if (matchingRoot === undefined) {
    diagnostics.push(missingCommitRootDiagnostic('invariants.requiredCommitRoots'));
  }

  return diagnostics;
}

function isVersionObjectRecordCandidate(value: unknown): value is VersionObjectRecord<unknown> {
  return isPlainRecord(value) && isPlainRecord(value.preimage);
}
