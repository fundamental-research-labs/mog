import { isObjectDigest, isWorkbookCommitId, type ObjectDigest } from './object-digest';
import { normalizeVersionGraphNamespace, type VersionGraphNamespace } from './object-store';
import {
  diagnostic,
  errorName,
  freezeDiagnostics,
  semanticIdentityFailure,
} from './snapshot-root-reload-diagnostics';
import type {
  SnapshotRootFreshLifecycleHydrationResult,
  SnapshotRootReloadCommitRootProof,
  SnapshotRootReloadDiagnostic,
  SnapshotRootReloadInvariants,
  SnapshotRootReloadResult,
  SnapshotRootReloadSourceKind,
  SnapshotRootSemanticIdentityProof,
  SnapshotRootSemanticIdentityVerificationResult,
} from './snapshot-root-reload-types';

type DiagnosticDetails = Readonly<Record<string, string | number | boolean | null>>;

type DecodedSnapshotRootIdentityInput = {
  readonly source: SnapshotRootReloadSourceKind;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly objectDigest?: ObjectDigest;
  readonly namespace?: VersionGraphNamespace;
};

export async function validateSemanticIdentityProof<TMaterialized>(
  decoded: DecodedSnapshotRootIdentityInput,
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
        ...(decoded.namespace === undefined
          ? {}
          : { namespace: cloneNamespace(decoded.namespace) }),
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

export function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export function cloneDigest(digest: ObjectDigest): ObjectDigest {
  return Object.freeze({ algorithm: digest.algorithm, digest: digest.digest });
}

export function cloneNamespace(namespace: VersionGraphNamespace): VersionGraphNamespace {
  return normalizeVersionGraphNamespace(namespace);
}

export function freezeCommitRoots(
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

export function isValidCommitRoot(value: unknown): value is SnapshotRootReloadCommitRootProof {
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

export function isSemanticIdentityProof(
  value: unknown,
): value is SnapshotRootSemanticIdentityProof {
  if (!isPlainRecord(value)) return false;
  if (typeof value.proofKind !== 'string' || value.proofKind.length === 0) return false;
  if (value.semanticIdentityDigest !== undefined && !isObjectDigest(value.semanticIdentityDigest)) {
    return false;
  }
  if (value.details !== undefined && !isDiagnosticDetails(value.details)) return false;
  return true;
}

export function cloneSemanticIdentityProof(
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

export function digestsEqual(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
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
