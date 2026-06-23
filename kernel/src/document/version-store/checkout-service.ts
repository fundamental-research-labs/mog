import {
  parseWorkbookCommitId,
  type ObjectDigest,
  type VersionDependencyRef,
  type VersionObjectType,
  type WorkbookCommitId,
} from './object-digest';
import type {
  ReadWorkbookCommitResult,
  WorkbookCommit,
  WorkbookCommitCompletenessDiagnostic,
  WorkbookCommitStoreDiagnostic,
} from './commit-store';
import type { VersionGraphStoreDiagnostic } from './graph-store';
import { validateRefName, type RefName, type RefNameDiagnostic } from './ref-name';
import type { GetRefResult, RefVersion, VersionDiagnostic } from './ref-store';
import type { VersionObjectStoreDiagnostic } from './object-store';
import type { VersionStoreDiagnostic as ProviderVersionStoreDiagnostic } from './provider';
import { checkoutAccessDeniedDiagnosticDetails } from './checkout-access-diagnostics';
import {
  applyCheckoutMaterializationPlan,
  type CheckoutMaterializationMutationGuarantee,
  type CheckoutSnapshotMaterializer,
  type CheckoutSnapshotReader,
} from './checkout-apply';

type MaybePromise<T> = T | Promise<T>;

export type CheckoutMaterializationRequest =
  | {
      readonly target: 'commit';
      readonly commitId: WorkbookCommitId | string;
    }
  | {
      readonly target: 'ref';
      readonly refName: RefName | 'HEAD' | string;
    };

export type CheckoutMaterializationErrorCode =
  | 'invalidCheckoutTarget'
  | 'unsupportedCheckoutTarget'
  | 'checkoutAccessDenied'
  | 'checkoutRefNotFound'
  | 'checkoutCommitNotFound'
  | 'checkoutCommitUnmaterializable'
  | 'checkoutDependencyMissing'
  | 'checkoutCommitReadFailed'
  | 'checkoutRefReadFailed'
  | 'checkoutDependencyReadFailed'
  | 'checkoutProviderUnavailable'
  | 'checkoutSnapshotReadFailed'
  | 'checkoutMaterializerUnavailable'
  | 'checkoutSnapshotApplyFailed';

export type CheckoutMaterializationDiagnosticCode =
  | 'VERSION_CHECKOUT_INVALID_TARGET'
  | 'VERSION_CHECKOUT_UNSUPPORTED_TARGET'
  | 'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED'
  | 'VERSION_CHECKOUT_DETACHED_HEAD_UNSUPPORTED'
  | 'VERSION_CHECKOUT_MISSING_REF_READER'
  | 'VERSION_CHECKOUT_MISSING_HEAD_READER'
  | 'VERSION_CHECKOUT_REF_READ_FAILED'
  | 'VERSION_CHECKOUT_MISSING_REF'
  | 'VERSION_CHECKOUT_MISSING_COMMIT'
  | 'VERSION_CHECKOUT_COMMIT_READ_FAILED'
  | 'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC'
  | 'VERSION_CHECKOUT_DIRTY_WORKING_STATE'
  | 'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT'
  | 'VERSION_CHECKOUT_MISSING_DEPENDENCY'
  | 'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED'
  | 'VERSION_CHECKOUT_PROVIDER_ERROR'
  | 'VERSION_CHECKOUT_SNAPSHOT_READ_FAILED'
  | 'VERSION_CHECKOUT_MATERIALIZER_UNAVAILABLE'
  | 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED'
  | 'VERSION_CHECKOUT_WRITE_FENCE_STALE'
  | 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE'
  | 'VERSION_PERMISSION_DENIED';

export type CheckoutMaterializationDiagnosticSource =
  | CheckoutMaterializationDiagnostic
  | WorkbookCommitCompletenessDiagnostic
  | WorkbookCommitStoreDiagnostic
  | RefNameDiagnostic
  | VersionDiagnostic
  | VersionObjectStoreDiagnostic
  | VersionGraphStoreDiagnostic
  | ProviderVersionStoreDiagnostic;

export interface CheckoutMaterializationDiagnostic {
  readonly code: CheckoutMaterializationDiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error' | 'corruption';
  readonly message: string;
  readonly refName?: string;
  readonly commitId?: WorkbookCommitId;
  readonly refVersion?: RefVersion;
  readonly refIncarnationId?: string;
  readonly objectDigest?: ObjectDigest;
  readonly dependency?: VersionDependencyRef;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly CheckoutMaterializationDiagnosticSource[];
}

export interface CheckoutMaterializationError {
  readonly code: CheckoutMaterializationErrorCode;
  readonly message: string;
  readonly diagnostics?: readonly CheckoutMaterializationDiagnostic[];
}

export interface CheckoutCommitReader {
  readCommit(commitId: WorkbookCommitId): MaybePromise<ReadWorkbookCommitResult>;
}

export interface CheckoutDependencyReader {
  hasDependency(dependency: VersionDependencyRef): MaybePromise<boolean>;
}

export type CheckoutHeadState =
  | {
      readonly mode: 'attached';
      readonly refName: RefName | string;
      readonly commitId: WorkbookCommitId | string;
      readonly refVersion?: RefVersion;
      readonly refIncarnationId?: string;
    }
  | {
      readonly mode: 'detached';
      readonly commitId: WorkbookCommitId | string;
      readonly materializationId: string;
    };

export type CheckoutHeadReadResult =
  | {
      readonly ok: true;
      readonly head: CheckoutHeadState;
      readonly diagnostics?: readonly CheckoutMaterializationDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
    };

export interface CheckoutHeadReader {
  readHead(): MaybePromise<CheckoutHeadReadResult>;
}

export interface CheckoutRefReader {
  readRef(refName: RefName): MaybePromise<GetRefResult>;
}

export interface CheckoutMaterializationServiceOptions {
  readonly commitReader: CheckoutCommitReader;
  readonly dependencyReader: CheckoutDependencyReader;
  readonly headReader?: CheckoutHeadReader;
  readonly refReader?: CheckoutRefReader;
  readonly snapshotReader?: CheckoutSnapshotReader;
  readonly snapshotMaterializer?: CheckoutSnapshotMaterializer;
}

export type CheckoutMaterializationDependencyRole =
  | 'snapshotRoot'
  | 'semanticChangeSet'
  | 'mutationSegment'
  | 'redactionSummary'
  | 'verificationSummary';

export interface CheckoutMaterializationDependency {
  readonly role: CheckoutMaterializationDependencyRole;
  readonly objectType: VersionObjectType;
  readonly digest: ObjectDigest;
  readonly index?: number;
}

export type CheckoutResolvedMaterializationTarget =
  | {
      readonly kind: 'commit';
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly kind: 'ref';
      readonly refName: RefName;
      readonly commitId: WorkbookCommitId;
      readonly refVersion: RefVersion;
      readonly refIncarnationId: string;
    }
  | {
      readonly kind: 'head';
      readonly refName: RefName;
      readonly commitId: WorkbookCommitId;
      readonly refVersion?: RefVersion;
      readonly refIncarnationId?: string;
    };

export interface CheckoutMaterializationPlan {
  readonly strategy: 'fullSnapshot';
  readonly resolvedTarget: CheckoutResolvedMaterializationTarget;
  readonly commitId: WorkbookCommitId;
  readonly parentCommitIds: readonly WorkbookCommitId[];
  readonly snapshotRootDigest: ObjectDigest;
  readonly semanticChangeSetDigest: ObjectDigest;
  readonly mutationSegmentDigests: readonly ObjectDigest[];
  readonly requiredDependencies: readonly CheckoutMaterializationDependency[];
  readonly requiredDependencyDigests: readonly ObjectDigest[];
}

export type CheckoutMaterializationResult =
  | {
      readonly ok: true;
      readonly materialization: 'planned';
      readonly plan: CheckoutMaterializationPlan;
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
      readonly mutationGuarantee: 'no-workbook-mutation';
    }
  | {
      readonly ok: true;
      readonly materialization: 'applied';
      readonly plan: CheckoutMaterializationPlan;
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
      readonly mutationGuarantee: 'workbook-state-materialized';
    }
  | {
      readonly ok: false;
      readonly error: CheckoutMaterializationError;
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
      readonly mutationGuarantee: Extract<
        CheckoutMaterializationMutationGuarantee,
        'no-workbook-mutation' | 'unknown-after-partial-mutation'
      >;
    };

type ParsedCheckoutRequest =
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

type ResolvedTargetResult =
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

export class CheckoutMaterializationService {
  private readonly commitReader: CheckoutCommitReader;
  private readonly dependencyReader: CheckoutDependencyReader;
  private readonly headReader?: CheckoutHeadReader;
  private readonly refReader?: CheckoutRefReader;
  private readonly snapshotReader?: CheckoutSnapshotReader;
  private readonly snapshotMaterializer?: CheckoutSnapshotMaterializer;

  constructor(options: CheckoutMaterializationServiceOptions) {
    this.commitReader = options.commitReader;
    this.dependencyReader = options.dependencyReader;
    this.headReader = options.headReader;
    this.refReader = options.refReader;
    this.snapshotReader = options.snapshotReader;
    this.snapshotMaterializer = options.snapshotMaterializer;
  }

  async planCheckout(
    request: CheckoutMaterializationRequest,
  ): Promise<CheckoutMaterializationResult> {
    const parsed = parseCheckoutMaterializationRequest(request);
    if (!parsed.ok) return parsed.result;

    const resolved = await this.resolveTarget(parsed);
    if (!resolved.ok) return resolved.result;

    let read: ReadWorkbookCommitResult;
    try {
      read = await this.commitReader.readCommit(resolved.commitId);
    } catch (error) {
      return failure('checkoutCommitReadFailed', 'Commit reader failed while resolving checkout.', [
        diagnostic(
          'VERSION_CHECKOUT_COMMIT_READ_FAILED',
          'Commit reader failed while resolving checkout.',
          {
            commitId: resolved.commitId,
            details: { cause: errorName(error) },
          },
        ),
      ]);
    }

    if (read.status !== 'success') {
      return commitReadFailure(resolved.commitId, read.diagnostics);
    }

    const blockingCompletenessDiagnostics = read.commit.payload.completenessDiagnostics.filter(
      (entry) => entry.severity === 'error',
    );
    if (blockingCompletenessDiagnostics.length > 0) {
      return failure(
        'checkoutCommitUnmaterializable',
        'Target commit has blocking materialization diagnostics.',
        [
          diagnostic(
            'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT',
            'Target commit has blocking materialization diagnostics.',
            {
              commitId: read.commit.id,
              sourceDiagnostics: blockingCompletenessDiagnostics,
            },
          ),
        ],
      );
    }

    const dependencyDiagnostics = await this.validateDependencies(read.commit);
    if (dependencyDiagnostics.length > 0) {
      const hasReadFailure = dependencyDiagnostics.some(
        (entry) => entry.code === 'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED',
      );
      return failure(
        hasReadFailure ? 'checkoutDependencyReadFailed' : 'checkoutDependencyMissing',
        hasReadFailure
          ? 'Dependency reader failed while preflighting checkout materialization.'
          : 'Target commit is missing required materialization dependencies.',
        dependencyDiagnostics,
      );
    }

    const plan = createMaterializationPlan(read.commit, resolved.target);
    const diagnostics = freezeDiagnostics([
      ...resolved.diagnostics,
      ...nonBlockingCompletenessDiagnostics(read.commit),
    ]);

    return {
      ok: true,
      materialization: 'planned',
      plan,
      diagnostics,
      mutationGuarantee: 'no-workbook-mutation',
    };
  }

  async checkout(
    request: CheckoutMaterializationRequest,
  ): Promise<CheckoutMaterializationResult> {
    const planned = await this.planCheckout(request);
    if (!planned.ok) return planned;
    return this.applyPlan(planned.plan, planned.diagnostics);
  }

  private async applyPlan(
    plan: CheckoutMaterializationPlan,
    preflightDiagnostics: readonly CheckoutMaterializationDiagnostic[],
  ): Promise<CheckoutMaterializationResult> {
    return applyCheckoutMaterializationPlan({
      plan,
      preflightDiagnostics,
      snapshotReader: this.snapshotReader,
      snapshotMaterializer: this.snapshotMaterializer,
    });
  }

  private async resolveTarget(
    parsed: Extract<ParsedCheckoutRequest, { ok: true }>,
  ): Promise<ResolvedTargetResult> {
    if (parsed.target === 'commit') {
      return {
        ok: true,
        target: Object.freeze({ kind: 'commit', commitId: parsed.commitId }),
        commitId: parsed.commitId,
        diagnostics: [],
      };
    }

    if (parsed.target === 'head') {
      return this.resolveHead();
    }

    return this.resolveRef(parsed.refName);
  }

  private async resolveHead(): Promise<ResolvedTargetResult> {
    if (this.headReader === undefined) {
      return failureResult('unsupportedCheckoutTarget', 'HEAD checkout requires a head reader.', [
        diagnostic('VERSION_CHECKOUT_MISSING_HEAD_READER', 'HEAD checkout requires a head reader.'),
      ]);
    }

    let result: CheckoutHeadReadResult;
    try {
      result = await this.headReader.readHead();
    } catch (error) {
      return failureResult('checkoutRefReadFailed', 'Head reader failed while resolving HEAD.', [
        diagnostic('VERSION_CHECKOUT_REF_READ_FAILED', 'Head reader failed while resolving HEAD.', {
          details: { cause: errorName(error) },
        }),
      ]);
    }

    if (!result.ok) {
      const denied = accessDeniedDiagnosticFromSources(
        result.diagnostics,
        'HEAD checkout is not authorized for this caller.',
      );
      if (denied) {
        return failureResult(
          'checkoutAccessDenied',
          'HEAD checkout is not authorized for this caller.',
          [denied],
        );
      }
      return failureResult('checkoutRefReadFailed', 'Head reader failed while resolving HEAD.', [
        diagnostic('VERSION_CHECKOUT_REF_READ_FAILED', 'Head reader failed while resolving HEAD.', {
          sourceDiagnostics: result.diagnostics,
        }),
      ]);
    }

    if (result.head.mode === 'detached') {
      const commitId = parseOptionalCommitId(result.head.commitId);
      return failureResult(
        'unsupportedCheckoutTarget',
        'Detached HEAD checkout materialization is not supported by this adapter.',
        [
          diagnostic(
            'VERSION_CHECKOUT_DETACHED_HEAD_UNSUPPORTED',
            'Detached HEAD checkout materialization is not supported by this adapter.',
            {
              ...(commitId === undefined ? {} : { commitId }),
              details: { materializationId: result.head.materializationId },
            },
          ),
        ],
      );
    }

    const refName = parseRefNameForTarget(result.head.refName);
    if (!refName.ok) return { ok: false, result: refName.result };

    const commitId = parseCommitIdForTarget(result.head.commitId, 'head.commitId');
    if (!commitId.ok) return { ok: false, result: commitId.result };

    return {
      ok: true,
      target: freezeResolvedTarget({
        kind: 'head',
        refName: refName.refName,
        commitId: commitId.commitId,
        ...(result.head.refVersion === undefined ? {} : { refVersion: result.head.refVersion }),
        ...(result.head.refIncarnationId === undefined
          ? {}
          : { refIncarnationId: result.head.refIncarnationId }),
      }),
      commitId: commitId.commitId,
      diagnostics: freezeDiagnostics(result.diagnostics ?? []),
    };
  }

  private async resolveRef(refName: RefName): Promise<ResolvedTargetResult> {
    if (this.refReader === undefined) {
      return failureResult('unsupportedCheckoutTarget', 'Ref checkout requires a ref reader.', [
        diagnostic('VERSION_CHECKOUT_MISSING_REF_READER', 'Ref checkout requires a ref reader.', {
          refName,
        }),
      ]);
    }

    let result: GetRefResult;
    try {
      result = await this.refReader.readRef(refName);
    } catch (error) {
      return failureResult('checkoutRefReadFailed', 'Ref reader failed while resolving checkout.', [
        diagnostic(
          'VERSION_CHECKOUT_REF_READ_FAILED',
          'Ref reader failed while resolving checkout.',
          {
            refName,
            details: { cause: errorName(error) },
          },
        ),
      ]);
    }

    if (!result.ok) {
      const denied = accessDeniedDiagnosticFromSources(
        result.diagnostics,
        'Ref checkout is not authorized for this caller.',
        refName,
      );
      if (denied) {
        return failureResult(
          'checkoutAccessDenied',
          'Ref checkout is not authorized for this caller.',
          [denied],
        );
      }
      return failureResult('checkoutRefReadFailed', 'Ref reader failed while resolving checkout.', [
        diagnostic(
          'VERSION_CHECKOUT_REF_READ_FAILED',
          'Ref reader failed while resolving checkout.',
          {
            refName,
            sourceDiagnostics: result.diagnostics,
          },
        ),
      ]);
    }

    if (result.ref === null) {
      return failureResult('checkoutRefNotFound', 'Checkout ref was not found.', [
        diagnostic('VERSION_CHECKOUT_MISSING_REF', 'Checkout ref was not found.', { refName }),
      ]);
    }

    const target = freezeResolvedTarget({
      kind: 'ref',
      refName,
      commitId: result.ref.targetCommitId,
      refVersion: result.ref.refVersion,
      refIncarnationId: result.ref.refIncarnationId,
    });

    return {
      ok: true,
      target,
      commitId: result.ref.targetCommitId,
      diagnostics: freezeDiagnostics(result.diagnostics),
    };
  }

  private async validateDependencies(
    commit: WorkbookCommit,
  ): Promise<readonly CheckoutMaterializationDiagnostic[]> {
    const diagnostics: CheckoutMaterializationDiagnostic[] = [];

    for (const dependency of materializationDependencies(commit).map(dependencyRefForPlan)) {
      try {
        if (!(await this.dependencyReader.hasDependency(dependency))) {
          diagnostics.push(
            diagnostic(
              'VERSION_CHECKOUT_MISSING_DEPENDENCY',
              'Target commit dependency is missing for checkout materialization.',
              {
                commitId: commit.id,
                objectDigest: dependency.digest,
                dependency,
              },
            ),
          );
        }
      } catch (error) {
        diagnostics.push(
          diagnostic(
            'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED',
            'Dependency reader failed during checkout preflight.',
            {
              commitId: commit.id,
              objectDigest: dependency.digest,
              dependency,
              details: { cause: errorName(error) },
            },
          ),
        );
      }
    }

    return freezeDiagnostics(diagnostics);
  }
}

export function createCheckoutMaterializationService(
  options: CheckoutMaterializationServiceOptions,
): CheckoutMaterializationService {
  return new CheckoutMaterializationService(options);
}

function parseCheckoutMaterializationRequest(request: unknown): ParsedCheckoutRequest {
  if (!isPlainRecord(request)) {
    return invalidTarget('Checkout materialization request must be an object.');
  }

  if (request.target === 'commit') {
    if (!hasExactKeys(request, ['commitId', 'target'])) {
      return invalidTarget('Commit checkout target must contain exactly target and commitId.');
    }
    const commitId = parseCommitIdForTarget(request.commitId, 'commitId');
    if (!commitId.ok) return { ok: false, result: commitId.result };
    return { ok: true, target: 'commit', commitId: commitId.commitId };
  }

  if (request.target === 'ref') {
    if (!hasExactKeys(request, ['refName', 'target'])) {
      return invalidTarget('Ref checkout target must contain exactly target and refName.');
    }
    if (request.refName === 'HEAD') {
      return { ok: true, target: 'head' };
    }
    const refName = parseRefNameForTarget(request.refName);
    if (!refName.ok) return { ok: false, result: refName.result };
    return { ok: true, target: 'ref', refName: refName.refName };
  }

  if (request.target === 'detached') {
    return {
      ok: false,
      result: failure(
        'unsupportedCheckoutTarget',
        'Detached checkout targets are not supported by this adapter.',
        [
          diagnostic(
            'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED',
            'Detached checkout targets are not supported by this adapter.',
          ),
        ],
      ),
    };
  }

  return {
    ok: false,
    result: failure('unsupportedCheckoutTarget', 'Unsupported checkout target.', [
      diagnostic('VERSION_CHECKOUT_UNSUPPORTED_TARGET', 'Unsupported checkout target.', {
        details: { target: formatUnknown(request.target) },
      }),
    ]),
  };
}

function parseCommitIdForTarget(
  value: unknown,
  path: string,
):
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly result: CheckoutMaterializationResult } {
  try {
    return { ok: true, commitId: parseWorkbookCommitId(value, path) };
  } catch {
    return {
      ok: false,
      result: failure('invalidCheckoutTarget', `${path} must be commit:sha256:<64 hex>.`, [
        diagnostic('VERSION_CHECKOUT_INVALID_TARGET', `${path} must be commit:sha256:<64 hex>.`, {
          details: { path, received: formatUnknown(value) },
        }),
      ]),
    };
  }
}

function parseOptionalCommitId(value: unknown): WorkbookCommitId | undefined {
  try {
    return parseWorkbookCommitId(value);
  } catch {
    return undefined;
  }
}

function parseRefNameForTarget(
  value: unknown,
):
  | { readonly ok: true; readonly refName: RefName }
  | { readonly ok: false; readonly result: CheckoutMaterializationResult } {
  const result = validateRefName(value);
  if (result.ok) return { ok: true, refName: result.name };

  return {
    ok: false,
    result: failure('invalidCheckoutTarget', 'Checkout ref target is invalid.', [
      diagnostic('VERSION_CHECKOUT_INVALID_TARGET', 'Checkout ref target is invalid.', {
        ...(typeof value === 'string' ? { refName: value } : {}),
        sourceDiagnostics: result.diagnostics,
        details: { received: formatUnknown(value) },
      }),
    ]),
  };
}

function invalidTarget(message: string): ParsedCheckoutRequest {
  return {
    ok: false,
    result: failure('invalidCheckoutTarget', message, [
      diagnostic('VERSION_CHECKOUT_INVALID_TARGET', message),
    ]),
  };
}

function commitReadFailure(
  commitId: WorkbookCommitId,
  sourceDiagnostics: readonly WorkbookCommitStoreDiagnostic[],
): CheckoutMaterializationResult {
  if (diagnosticsContainCode(sourceDiagnostics, 'VERSION_OBJECT_NOT_FOUND')) {
    return failure('checkoutCommitNotFound', 'Checkout commit was not found.', [
      diagnostic('VERSION_CHECKOUT_MISSING_COMMIT', 'Checkout commit was not found.', {
        commitId,
        sourceDiagnostics,
      }),
    ]);
  }

  if (
    diagnosticsContainCode(sourceDiagnostics, 'VERSION_MISSING_DEPENDENCY') ||
    diagnosticsContainCode(sourceDiagnostics, 'VERSION_MISSING_PARENT')
  ) {
    return failure(
      'checkoutDependencyMissing',
      'Target commit is missing required materialization dependencies.',
      [
        diagnostic(
          'VERSION_CHECKOUT_MISSING_DEPENDENCY',
          'Target commit is missing required materialization dependencies.',
          {
            commitId,
            sourceDiagnostics,
          },
        ),
      ],
    );
  }

  return failure('checkoutCommitReadFailed', 'Commit reader failed while resolving checkout.', [
    diagnostic(
      'VERSION_CHECKOUT_COMMIT_READ_FAILED',
      'Commit reader failed while resolving checkout.',
      {
        commitId,
        sourceDiagnostics,
      },
    ),
  ]);
}

function createMaterializationPlan(
  commit: WorkbookCommit,
  resolvedTarget: CheckoutResolvedMaterializationTarget,
): CheckoutMaterializationPlan {
  const dependencies = materializationDependencies(commit);
  return Object.freeze({
    strategy: 'fullSnapshot',
    resolvedTarget,
    commitId: commit.id,
    parentCommitIds: Object.freeze([...commit.payload.parentCommitIds]),
    snapshotRootDigest: cloneDigest(commit.payload.snapshotRootDigest),
    semanticChangeSetDigest: cloneDigest(commit.payload.semanticChangeSetDigest),
    mutationSegmentDigests: Object.freeze(
      (commit.payload.mutationSegmentDigests ?? []).map(cloneDigest),
    ),
    requiredDependencies: Object.freeze(dependencies),
    requiredDependencyDigests: Object.freeze(
      dependencies.map((entry) => cloneDigest(entry.digest)),
    ),
  });
}

function materializationDependencies(
  commit: WorkbookCommit,
): readonly CheckoutMaterializationDependency[] {
  return Object.freeze([
    freezeMaterializationDependency({
      role: 'snapshotRoot',
      objectType: 'workbook.snapshotRoot.v1',
      digest: commit.payload.snapshotRootDigest,
    }),
    freezeMaterializationDependency({
      role: 'semanticChangeSet',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: commit.payload.semanticChangeSetDigest,
    }),
    ...(commit.payload.mutationSegmentDigests ?? []).map((digest, index) =>
      freezeMaterializationDependency({
        role: 'mutationSegment',
        objectType: 'workbook.mutationSegment.v1',
        digest,
        index,
      }),
    ),
    ...(commit.payload.redactionSummaryDigest === undefined
      ? []
      : [
          freezeMaterializationDependency({
            role: 'redactionSummary',
            objectType: 'workbook.redactionSummary.v1',
            digest: commit.payload.redactionSummaryDigest,
          }),
        ]),
    ...(commit.payload.verificationSummaryDigest === undefined
      ? []
      : [
          freezeMaterializationDependency({
            role: 'verificationSummary',
            objectType: 'workbook.verificationSummary.v1',
            digest: commit.payload.verificationSummaryDigest,
          }),
        ]),
  ]);
}

function dependencyRefForPlan(dependency: CheckoutMaterializationDependency): VersionDependencyRef {
  return Object.freeze({
    kind: 'object',
    objectType: dependency.objectType,
    digest: cloneDigest(dependency.digest),
  });
}

function nonBlockingCompletenessDiagnostics(
  commit: WorkbookCommit,
): readonly CheckoutMaterializationDiagnostic[] {
  return commit.payload.completenessDiagnostics
    .filter((entry) => entry.severity !== 'error')
    .map((entry) =>
      diagnostic(
        'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC',
        'Target commit has non-blocking completeness diagnostics.',
        {
          severity: entry.severity,
          commitId: commit.id,
          sourceDiagnostics: [entry],
        },
      ),
    );
}

function diagnosticsContainCode(
  diagnostics: readonly CheckoutMaterializationDiagnosticSource[],
  code: string,
): boolean {
  return diagnostics.some((entry) => {
    if (entry.code === code) return true;
    if ('sourceDiagnostics' in entry && entry.sourceDiagnostics !== undefined) {
      return diagnosticsContainCode(entry.sourceDiagnostics, code);
    }
    return false;
  });
}

function accessDeniedDiagnosticFromSources(
  diagnostics: readonly CheckoutMaterializationDiagnosticSource[],
  message: string,
  refName?: RefName,
): CheckoutMaterializationDiagnostic | null {
  const details = checkoutAccessDeniedDiagnosticDetails(diagnostics);
  if (!details) return null;
  return diagnostic('VERSION_PERMISSION_DENIED', message, {
    ...(refName ? { refName } : {}),
    sourceDiagnostics: diagnostics,
    details,
  });
}

function failureResult(
  code: CheckoutMaterializationErrorCode,
  message: string,
  diagnostics: readonly CheckoutMaterializationDiagnostic[],
): ResolvedTargetResult {
  return { ok: false, result: failure(code, message, diagnostics) };
}

function failure(
  code: CheckoutMaterializationErrorCode,
  message: string,
  diagnostics: readonly CheckoutMaterializationDiagnostic[],
): CheckoutMaterializationResult {
  const frozenDiagnostics = freezeDiagnostics(diagnostics);
  return {
    ok: false,
    error: Object.freeze({
      code,
      message,
      diagnostics: frozenDiagnostics,
    }),
    diagnostics: frozenDiagnostics,
    mutationGuarantee: 'no-workbook-mutation',
  };
}

function diagnostic(
  code: CheckoutMaterializationDiagnosticCode,
  message: string,
  options: Omit<CheckoutMaterializationDiagnostic, 'code' | 'severity' | 'message'> & {
    readonly severity?: CheckoutMaterializationDiagnostic['severity'];
  } = {},
): CheckoutMaterializationDiagnostic {
  const { severity = 'error', ...rest } = options;
  return Object.freeze({
    code,
    severity,
    message,
    ...rest,
  });
}

function freezeDiagnostics(
  diagnostics: readonly CheckoutMaterializationDiagnostic[],
): readonly CheckoutMaterializationDiagnostic[] {
  return Object.freeze([...diagnostics]);
}

function freezeResolvedTarget(
  target: CheckoutResolvedMaterializationTarget,
): CheckoutResolvedMaterializationTarget {
  if (target.kind === 'commit') {
    return Object.freeze({ kind: 'commit', commitId: target.commitId });
  }
  if (target.kind === 'ref') {
    return Object.freeze({
      kind: 'ref',
      refName: target.refName,
      commitId: target.commitId,
      refVersion: cloneRefVersion(target.refVersion),
      refIncarnationId: target.refIncarnationId,
    });
  }
  return Object.freeze({
    kind: 'head',
    refName: target.refName,
    commitId: target.commitId,
    ...(target.refVersion === undefined ? {} : { refVersion: cloneRefVersion(target.refVersion) }),
    ...(target.refIncarnationId === undefined ? {} : { refIncarnationId: target.refIncarnationId }),
  });
}

function freezeMaterializationDependency(
  dependency: CheckoutMaterializationDependency,
): CheckoutMaterializationDependency {
  return Object.freeze({
    ...dependency,
    digest: cloneDigest(dependency.digest),
  });
}

function cloneDigest(digest: ObjectDigest): ObjectDigest {
  return Object.freeze({ algorithm: digest.algorithm, digest: digest.digest });
}

function cloneRefVersion(refVersion: RefVersion): RefVersion {
  return Object.freeze({ kind: refVersion.kind, value: refVersion.value });
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
