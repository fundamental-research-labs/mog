import {
  isObjectDigest,
  isWorkbookCommitId,
  type ObjectDigest,
} from './object-digest';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from './object-store';
import {
  SnapshotRootCaptureError,
  decodeYrsFullStateSnapshotRootPayload,
  validateWorkbookSnapshotRootRecord,
  validateYrsFullStateSnapshotRootPayload,
} from './snapshot-root-capture';
import type {
  SnapshotRootFreshLifecycleHydrationInput,
  SnapshotRootFreshLifecycleHydrationResult,
  SnapshotRootFreshLifecycleMutationGuarantee,
  SnapshotRootReloadCommitRootProof,
  SnapshotRootReloadDiagnostic,
  SnapshotRootReloadDiagnosticCode,
  SnapshotRootReloadErrorCode,
  SnapshotRootReloadInvariants,
  SnapshotRootReloadResult,
  SnapshotRootReloadSourceKind,
  SnapshotRootSemanticIdentityProof,
  SnapshotRootSemanticIdentityVerificationResult,
} from './snapshot-root-reload-types';

type DiagnosticDetails = Readonly<Record<string, string | number | boolean | null>>;

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

export function createSnapshotRootReloadHydratorFailedResult<TMaterialized>(
  error: unknown,
  decodedByteLength: number,
): Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: false }> {
  return failure(
    'hydratorFailed',
    'Snapshot root fresh-lifecycle hydrator threw before reporting materialization.',
    [
      diagnostic(
        'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_FAILED',
        'Snapshot root fresh-lifecycle hydrator threw before reporting materialization.',
        { details: { cause: errorName(error) } },
      ),
    ],
    'unknown-after-hydrator-failure',
    decodedByteLength,
  );
}

export function createSnapshotRootReloadHydratorRejectedResult<TMaterialized>(
  hydration: Extract<
    SnapshotRootFreshLifecycleHydrationResult<TMaterialized>,
    { readonly status: 'failed' }
  >,
  decodedByteLength: number,
): Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: false }> {
  const hydratorDiagnostics = freezeDiagnostics(hydration.diagnostics);
  return failure(
    'hydratorRejected',
    'Snapshot root fresh-lifecycle hydrator did not materialize the snapshot root.',
    hydratorDiagnostics.length > 0
      ? hydratorDiagnostics
      : [
          diagnostic(
            'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_REJECTED',
            'Snapshot root fresh-lifecycle hydrator did not materialize the snapshot root.',
          ),
        ],
    hydration.freshLifecycleMutationGuarantee ?? 'unknown-after-hydrator-failure',
    decodedByteLength,
  );
}

export function invalidHydratorResult<TMaterialized>(
  decodedByteLength: number,
): SnapshotRootReloadResult<TMaterialized> {
  return failure(
    'invalidHydratorResult',
    'Snapshot root fresh-lifecycle hydrator returned an invalid result.',
    [
      diagnostic(
        'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_HYDRATOR_RESULT',
        'Snapshot root fresh-lifecycle hydrator returned an invalid result.',
      ),
    ],
    'unknown-after-hydrator-failure',
    decodedByteLength,
  );
}

export function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
        wrongNamespaceDiagnostic('record.namespace', normalizedExpectedNamespace, decoded.namespace),
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
      decoded.objectDigest !== undefined && digestsEqual(root.snapshotRootDigest, decoded.objectDigest)
    );
  });

  if (matchingRoot === undefined) {
    diagnostics.push(missingCommitRootDiagnostic('invariants.requiredCommitRoots'));
  }

  return diagnostics;
}

async function validateSemanticIdentityProof<TMaterialized>(
  decoded: DecodedSnapshotRoot,
  hydration: Extract<
    SnapshotRootFreshLifecycleHydrationResult<TMaterialized>,
    { readonly status: 'materialized' }
  >,
  invariants: SnapshotRootReloadInvariants<TMaterialized>,
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
  if (invariants.semanticIdentityVerifier !== undefined) {
    let verification: SnapshotRootSemanticIdentityVerificationResult;
    try {
      verification = await invariants.semanticIdentityVerifier({
        materialized: hydration.materialized,
        yrsFullStateBytes: cloneBytes(decoded.bytes),
        decodedByteLength: decoded.byteLength,
        source: decoded.source,
        ...(decoded.objectDigest === undefined
          ? {}
          : { objectDigest: cloneDigest(decoded.objectDigest) }),
        ...(decoded.namespace === undefined ? {} : { namespace: cloneNamespace(decoded.namespace) }),
        requiredCommitRoots: freezeCommitRoots(invariants.requiredCommitRoots ?? []),
      });
    } catch (error) {
      return semanticIdentityFailure(
        [
          diagnostic(
            'VERSION_SNAPSHOT_ROOT_RELOAD_SEMANTIC_IDENTITY_UNPROVEN',
            'Snapshot root semantic identity verifier threw before proving identity.',
            { details: { cause: errorName(error) } },
          ),
        ],
        decoded.byteLength,
      );
    }

    if (!isPlainRecord(verification)) {
      return semanticIdentityFailure(
        [
          diagnostic(
            'VERSION_SNAPSHOT_ROOT_RELOAD_SEMANTIC_IDENTITY_UNPROVEN',
            'Snapshot root semantic identity verifier returned an invalid result.',
          ),
        ],
        decoded.byteLength,
      );
    }

    if (verification.ok === false) {
      return semanticIdentityFailure(
        freezeDiagnostics(verification.diagnostics),
        decoded.byteLength,
      );
    }

    if (verification.ok !== true || !isSemanticIdentityProof(verification.proof)) {
      return semanticIdentityFailure(
        [
          diagnostic(
            'VERSION_SNAPSHOT_ROOT_RELOAD_SEMANTIC_IDENTITY_UNPROVEN',
            'Snapshot root semantic identity verifier did not return a valid proof.',
          ),
        ],
        decoded.byteLength,
      );
    }

    return {
      ok: true,
      proof: cloneSemanticIdentityProof(verification.proof),
      diagnostics: freezeDiagnostics(verification.diagnostics ?? []),
    };
  }

  if (hydration.semanticIdentityProof !== undefined) {
    if (isSemanticIdentityProof(hydration.semanticIdentityProof)) {
      return {
        ok: true,
        proof: cloneSemanticIdentityProof(hydration.semanticIdentityProof),
        diagnostics: [],
      };
    }
    return semanticIdentityFailure(
      [
        diagnostic(
          'VERSION_SNAPSHOT_ROOT_RELOAD_SEMANTIC_IDENTITY_UNPROVEN',
          'Snapshot root hydrator returned an invalid semantic identity proof.',
        ),
      ],
      decoded.byteLength,
    );
  }

  if (invariants.requireSemanticIdentityProof === true) {
    return semanticIdentityFailure(
      [
        diagnostic(
          'VERSION_SNAPSHOT_ROOT_RELOAD_SEMANTIC_IDENTITY_UNPROVEN',
          'Snapshot root reload requires a semantic identity proof.',
        ),
      ],
      decoded.byteLength,
    );
  }

  return { ok: true, diagnostics: [] };
}

function invariantFailure<TMaterialized>(
  diagnostics: readonly SnapshotRootReloadDiagnostic[],
  decodedByteLength: number,
): SnapshotRootReloadResult<TMaterialized> {
  const firstCode = diagnostics[0]?.code;
  if (firstCode === 'VERSION_SNAPSHOT_ROOT_RELOAD_WRONG_NAMESPACE') {
    return failure(
      'wrongSnapshotRootNamespace',
      'Snapshot root namespace does not match the reload target.',
      diagnostics,
      'not-started',
      decodedByteLength,
    );
  }
  return failure(
    'missingCommitRoot',
    'Snapshot root reload is missing a required commit-root proof.',
    diagnostics,
    'not-started',
    decodedByteLength,
  );
}

function semanticIdentityFailure<TMaterialized>(
  diagnostics: readonly SnapshotRootReloadDiagnostic[],
  decodedByteLength: number,
): {
  readonly ok: false;
  readonly result: Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: false }>;
} {
  return {
    ok: false,
    result: failure<TMaterialized>(
      'semanticIdentityUnproven',
      'Snapshot root fresh-lifecycle reload could not prove semantic identity.',
      diagnostics.length > 0
        ? diagnostics
        : [
            diagnostic(
              'VERSION_SNAPSHOT_ROOT_RELOAD_SEMANTIC_IDENTITY_UNPROVEN',
              'Snapshot root fresh-lifecycle reload could not prove semantic identity.',
            ),
          ],
      'fresh-lifecycle-rejected-after-materialization',
      decodedByteLength,
    ),
  };
}

function invalidSnapshotRootDiagnostic(error: unknown): SnapshotRootReloadDiagnostic {
  if (error instanceof SnapshotRootCaptureError) {
    return diagnostic('VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT', error.message, {
      path: error.path,
      details: { captureCode: error.code },
    });
  }

  return diagnostic(
    'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT',
    'Snapshot root validation failed.',
    { details: { cause: errorName(error) } },
  );
}

function failure<TMaterialized>(
  code: SnapshotRootReloadErrorCode,
  message: string,
  diagnostics: readonly SnapshotRootReloadDiagnostic[],
  freshLifecycleMutationGuarantee: Exclude<
    SnapshotRootFreshLifecycleMutationGuarantee,
    'fresh-lifecycle-materialized'
  >,
  decodedByteLength?: number,
): Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: false }> {
  const frozenDiagnostics = freezeDiagnostics(diagnostics);
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      message,
      diagnostics: frozenDiagnostics,
    }),
    diagnostics: frozenDiagnostics,
    ...(decodedByteLength === undefined ? {} : { decodedByteLength }),
    mutationGuarantee: 'no-current-workbook-mutation',
    freshLifecycleMutationGuarantee,
  });
}

function diagnostic(
  code: SnapshotRootReloadDiagnosticCode,
  message: string,
  options: Omit<SnapshotRootReloadDiagnostic, 'code' | 'severity' | 'message'> & {
    readonly severity?: SnapshotRootReloadDiagnostic['severity'];
  } = {},
): SnapshotRootReloadDiagnostic {
  const { severity = 'error', details, ...rest } = options;
  return Object.freeze({
    code,
    severity,
    message,
    ...rest,
    ...(details === undefined ? {} : { details: Object.freeze({ ...details }) }),
  });
}

function freezeDiagnostics(
  diagnostics: readonly SnapshotRootReloadDiagnostic[],
): readonly SnapshotRootReloadDiagnostic[] {
  return Object.freeze(
    diagnostics.map((entry) =>
      diagnostic(entry.code, entry.message, {
        severity: entry.severity,
        ...(entry.path === undefined ? {} : { path: entry.path }),
        ...(entry.details === undefined ? {} : { details: entry.details }),
      }),
    ),
  );
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function cloneDigest(digest: ObjectDigest): ObjectDigest {
  return Object.freeze({ algorithm: digest.algorithm, digest: digest.digest });
}

function cloneNamespace(namespace: VersionGraphNamespace): VersionGraphNamespace {
  return normalizeVersionGraphNamespace(namespace);
}

function freezeCommitRoots(
  roots: readonly SnapshotRootReloadCommitRootProof[],
): readonly SnapshotRootReloadCommitRootProof[] {
  return Object.freeze(
    roots.flatMap((root) =>
      isValidCommitRoot(root)
        ? [
            Object.freeze({
              commitId: root.commitId,
              namespace: cloneNamespace(root.namespace),
              snapshotRootDigest: cloneDigest(root.snapshotRootDigest),
            }),
          ]
        : [],
    ),
  );
}

function isValidCommitRoot(value: unknown): value is SnapshotRootReloadCommitRootProof {
  if (!isPlainRecord(value)) return false;
  if (!isWorkbookCommitId(value.commitId)) return false;
  if (!isObjectDigest(value.snapshotRootDigest)) return false;
  try {
    normalizeVersionGraphNamespace(value.namespace as VersionGraphNamespace);
    return true;
  } catch {
    return false;
  }
}

function isSemanticIdentityProof(value: unknown): value is SnapshotRootSemanticIdentityProof {
  if (!isPlainRecord(value)) return false;
  if (typeof value.proofKind !== 'string' || value.proofKind.length === 0) return false;
  if (
    value.semanticIdentityDigest !== undefined &&
    !isObjectDigest(value.semanticIdentityDigest)
  ) {
    return false;
  }
  if (value.details !== undefined && !isDiagnosticDetails(value.details)) return false;
  return true;
}

function cloneSemanticIdentityProof(
  proof: SnapshotRootSemanticIdentityProof,
): SnapshotRootSemanticIdentityProof {
  return Object.freeze({
    proofKind: proof.proofKind,
    ...(proof.semanticIdentityDigest === undefined
      ? {}
      : { semanticIdentityDigest: cloneDigest(proof.semanticIdentityDigest) }),
    ...(proof.details === undefined ? {} : { details: Object.freeze({ ...proof.details }) }),
  });
}

function isDiagnosticDetails(value: unknown): value is DiagnosticDetails {
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every(
    (entry) =>
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean' ||
      entry === null,
  );
}

function wrongNamespaceDiagnostic(
  path: string,
  expected: VersionGraphNamespace,
  received?: VersionGraphNamespace,
): SnapshotRootReloadDiagnostic {
  return diagnostic(
    'VERSION_SNAPSHOT_ROOT_RELOAD_WRONG_NAMESPACE',
    'Snapshot root namespace does not match the reload target.',
    {
      path,
      details: {
        expectedDocumentId: expected.documentId,
        expectedGraphId: expected.graphId,
        expectedPrincipalScope: expected.principalScope ?? null,
        receivedDocumentId: received?.documentId ?? null,
        receivedGraphId: received?.graphId ?? null,
        receivedPrincipalScope: received?.principalScope ?? null,
      },
    },
  );
}

function missingCommitRootDiagnostic(path: string): SnapshotRootReloadDiagnostic {
  return diagnostic(
    'VERSION_SNAPSHOT_ROOT_RELOAD_MISSING_COMMIT_ROOT',
    'Snapshot root reload is missing a required commit-root proof.',
    { path },
  );
}

function digestsEqual(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function isVersionObjectRecordCandidate(value: unknown): value is VersionObjectRecord<unknown> {
  return isPlainRecord(value) && isPlainRecord(value.preimage);
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}
